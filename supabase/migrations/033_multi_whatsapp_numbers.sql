-- ============================================================
-- 033_multi_whatsapp_numbers.sql — Multi-number / multi-inbox support
--
-- Moves wacrm from "one WhatsApp number per account" to "up to 5
-- numbers per account", each number acting as its own inbox.
--
-- What this migration does
--   1. Adds label / is_default / sort_order to whatsapp_config.
--   2. Removes the UNIQUE(account_id) one-per-account constraint.
--   3. Adds triggers to enforce (a) max 5 numbers per account and
--      (b) only one default number per account.
--   4. Adds whatsapp_config_id to conversations + broadcasts and
--      backfills both from the single existing config per account.
--   5. Creates agent_whatsapp_numbers for per-agent inbox assignment.
--   6. Rewrites RLS so admin/owner see every number/inbox while
--      agents/viewers see only their assigned numbers.
--
-- Idempotent and safe to re-run. Backfill only touches rows where
-- the new columns are NULL, so a re-run is a no-op once applied.
-- ============================================================

-- ============================================================
-- 0. Pre-check: existing conversations must not have duplicate
--    (account_id, contact_id) rows. Because there is currently only
--    one config per account, backfilling whatsapp_config_id would
--    turn those duplicates into duplicate (account_id, contact_id,
--    whatsapp_config_id) rows and break the new unique index.
--    Fail loudly here with the conflicting ids so the operator can
--    clean them up before re-running migrations.
-- ============================================================
DO $$
DECLARE
  dupe_count INT;
  sample TEXT;
BEGIN
  SELECT count(*) INTO dupe_count
  FROM (
    SELECT account_id, contact_id
    FROM conversations
    GROUP BY account_id, contact_id
    HAVING count(*) > 1
  ) dupes;

  IF dupe_count > 0 THEN
    SELECT string_agg(
      'account=' || account_id || ' contact=' || contact_id || ' ids=' || ids,
      E'\n  '
    )
    INTO sample
    FROM (
      SELECT account_id::text, contact_id::text,
             string_agg(id::text, ', ' ORDER BY id) AS ids
      FROM conversations
      GROUP BY account_id, contact_id
      HAVING count(*) > 1
      LIMIT 5
    ) d;

    RAISE EXCEPTION
      E'Cannot apply 033_multi_whatsapp_numbers.sql: % duplicate (account_id, contact_id) conversation group(s) exist.\nThe new schema requires uniqueness on (account_id, contact_id, whatsapp_config_id).\nSample duplicates:\n  %\nClean up duplicate conversations (merge messages into one row per contact) then re-run migrations.',
      dupe_count, sample
      USING ERRCODE = '23505';
  END IF;
END $$;

-- ============================================================
-- 1. whatsapp_config: metadata for each number
-- ============================================================
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Backfill label for the existing single row per account.
UPDATE whatsapp_config
SET label = COALESCE(label, 'WhatsApp')
WHERE label IS NULL;

-- Drop the one-row-per-account constraint. The global
-- UNIQUE(phone_number_id) stays — a Meta number can still belong to
-- only one wacrm account.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

-- Trigger: only one default number per account.
CREATE OR REPLACE FUNCTION enforce_single_default_whatsapp_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE whatsapp_config
  SET is_default = false
  WHERE account_id = NEW.account_id
    AND id <> NEW.id
    AND is_default = true;
  RETURN NEW;
END;
$$;

ALTER FUNCTION enforce_single_default_whatsapp_number() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_single_default_whatsapp_number ON whatsapp_config;
CREATE TRIGGER enforce_single_default_whatsapp_number
  BEFORE INSERT OR UPDATE OF is_default ON whatsapp_config
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION enforce_single_default_whatsapp_number();

-- Trigger: max 5 numbers per account.
CREATE OR REPLACE FUNCTION enforce_max_whatsapp_numbers_per_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (
    SELECT COUNT(*) FROM whatsapp_config WHERE account_id = NEW.account_id
  ) >= 5 THEN
    RAISE EXCEPTION 'An account can have at most 5 WhatsApp numbers'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION enforce_max_whatsapp_numbers_per_account() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_max_whatsapp_numbers_per_account ON whatsapp_config;
CREATE TRIGGER enforce_max_whatsapp_numbers_per_account
  BEFORE INSERT ON whatsapp_config
  FOR EACH ROW
  EXECUTE FUNCTION enforce_max_whatsapp_numbers_per_account();

-- Ensure every account with at least one number has a default.
UPDATE whatsapp_config c
SET is_default = true
WHERE is_default = false
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_config d
    WHERE d.account_id = c.account_id AND d.is_default = true
  );

-- ============================================================
-- 2. conversations: scope by whatsapp_config_id
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE RESTRICT;

-- Backfill with the single existing config for each account.
UPDATE conversations conv
SET whatsapp_config_id = cfg.id
FROM whatsapp_config cfg
WHERE conv.account_id = cfg.account_id
  AND conv.whatsapp_config_id IS NULL;

-- Every account must have at least one config before we can set NOT NULL.
-- If a conversation has no config, it means the account never connected
-- WhatsApp; that should not happen in practice, but fail loudly if it does.
DO $$
DECLARE
  orphan_count INT;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM conversations
  WHERE whatsapp_config_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Cannot apply migration: % conversation(s) have no whatsapp_config_id after backfill. Each conversation must belong to a WhatsApp number.',
      orphan_count
      USING ERRCODE = '23502';
  END IF;
END $$;

ALTER TABLE conversations ALTER COLUMN whatsapp_config_id SET NOT NULL;

-- Unique conversation per (account, contact, number).
DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_number
  ON conversations (account_id, contact_id, whatsapp_config_id);

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON conversations (whatsapp_config_id);

-- ============================================================
-- 3. broadcasts: remember which number sent them
-- ============================================================
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE RESTRICT;

UPDATE broadcasts b
SET whatsapp_config_id = cfg.id
FROM whatsapp_config cfg
WHERE b.account_id = cfg.account_id
  AND cfg.is_default = true
  AND b.whatsapp_config_id IS NULL;

-- Broadcasts without a config default to the account's default number
-- via the same backfill; if none exists, leave NULL (legacy broadcasts).

-- ============================================================
-- 4. agent_whatsapp_numbers: per-agent inbox assignment
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_whatsapp_numbers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  whatsapp_config_id UUID NOT NULL REFERENCES whatsapp_config(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, user_id, whatsapp_config_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_numbers_account_user
  ON agent_whatsapp_numbers (account_id, user_id);

CREATE INDEX IF NOT EXISTS idx_agent_numbers_account_config
  ON agent_whatsapp_numbers (account_id, whatsapp_config_id);

ALTER TABLE agent_whatsapp_numbers ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. RLS helper: is the caller assigned to a given number?
-- ============================================================
CREATE OR REPLACE FUNCTION is_agent_assigned_to_number(p_whatsapp_config_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM agent_whatsapp_numbers a
    WHERE a.user_id = auth.uid()
      AND a.whatsapp_config_id = p_whatsapp_config_id
  );
$$;

ALTER FUNCTION is_agent_assigned_to_number(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_agent_assigned_to_number(UUID) TO authenticated, service_role;

-- ============================================================
-- 6. RLS rewrite
-- ============================================================

-- ---- whatsapp_config -----------------------------------------
DROP POLICY IF EXISTS whatsapp_config_select ON whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_insert ON whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_update ON whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_delete ON whatsapp_config;

CREATE POLICY whatsapp_config_select ON whatsapp_config FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR is_agent_assigned_to_number(id)
);

CREATE POLICY whatsapp_config_insert ON whatsapp_config FOR INSERT WITH CHECK (
  is_account_member(account_id, 'admin')
);

CREATE POLICY whatsapp_config_update ON whatsapp_config FOR UPDATE USING (
  is_account_member(account_id, 'admin')
);

CREATE POLICY whatsapp_config_delete ON whatsapp_config FOR DELETE USING (
  is_account_member(account_id, 'admin')
);

-- ---- conversations ---------------------------------------------
DROP POLICY IF EXISTS conversations_select ON conversations;
DROP POLICY IF EXISTS conversations_insert ON conversations;
DROP POLICY IF EXISTS conversations_update ON conversations;
DROP POLICY IF EXISTS conversations_delete ON conversations;

CREATE POLICY conversations_select ON conversations FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR is_agent_assigned_to_number(whatsapp_config_id)
);

CREATE POLICY conversations_insert ON conversations FOR INSERT WITH CHECK (
  (is_account_member(account_id, 'admin') OR is_agent_assigned_to_number(whatsapp_config_id))
  AND is_account_member(account_id, 'agent')
);

CREATE POLICY conversations_update ON conversations FOR UPDATE USING (
  (is_account_member(account_id, 'admin') OR is_agent_assigned_to_number(whatsapp_config_id))
  AND is_account_member(account_id, 'agent')
);

CREATE POLICY conversations_delete ON conversations FOR DELETE USING (
  (is_account_member(account_id, 'admin') OR is_agent_assigned_to_number(whatsapp_config_id))
  AND is_account_member(account_id, 'agent')
);

-- ---- agent_whatsapp_numbers ------------------------------------
DROP POLICY IF EXISTS agent_whatsapp_numbers_select ON agent_whatsapp_numbers;
DROP POLICY IF EXISTS agent_whatsapp_numbers_insert ON agent_whatsapp_numbers;
DROP POLICY IF EXISTS agent_whatsapp_numbers_update ON agent_whatsapp_numbers;
DROP POLICY IF EXISTS agent_whatsapp_numbers_delete ON agent_whatsapp_numbers;

CREATE POLICY agent_whatsapp_numbers_select ON agent_whatsapp_numbers FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (user_id = auth.uid() AND is_account_member(account_id))
);

CREATE POLICY agent_whatsapp_numbers_insert ON agent_whatsapp_numbers FOR INSERT WITH CHECK (
  is_account_member(account_id, 'admin')
);

CREATE POLICY agent_whatsapp_numbers_update ON agent_whatsapp_numbers FOR UPDATE USING (
  is_account_member(account_id, 'admin')
);

CREATE POLICY agent_whatsapp_numbers_delete ON agent_whatsapp_numbers FOR DELETE USING (
  is_account_member(account_id, 'admin')
);

-- ============================================================
-- 7. Indexes on existing hot keys (defensive re-assert)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_account
  ON whatsapp_config (account_id);
