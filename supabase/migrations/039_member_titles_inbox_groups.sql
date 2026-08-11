-- ============================================================
-- 039_member_titles_inbox_groups.sql — Member titles + inbox groups
--
-- Two related "organise your team / inboxes" features:
--
--   1. Member titles. Each member can carry a free-text title
--      (e.g. "Sales", "Customer Support 1") shown across the app.
--      Titles are cosmetic — they never affect permissions, which
--      stay governed by account_role. Generic titles are suggested
--      from code presets; accounts can also curate their own custom
--      vocabulary in `member_titles`.
--
--   2. Inbox groups. Each WhatsApp number (whatsapp_config row) can
--      carry a free-text group label (e.g. "Support", "Sales") so
--      the inbox selector can group related numbers. Generic group
--      names come from code presets; accounts can curate custom
--      ones in `inbox_groups`.
--
-- Both vocabularies are account-scoped suggestion lists only:
-- deleting a vocabulary row never strips the value from members /
-- numbers that already use it.
--
-- What this migration does
--   1. Adds profiles.title (free text, nullable).
--   2. Creates member_titles (custom title vocabulary per account).
--   3. Creates inbox_groups (custom group vocabulary per account).
--   4. Adds whatsapp_config.inbox_group (free text, nullable).
--   5. Creates set_member_title() SECURITY DEFINER RPC — admin+
--      only write path for another member's title (profiles_update
--      RLS is self-only, so a supervised RPC mirrors set_member_role).
--
-- Idempotent and safe to re-run.
-- ============================================================

-- ============================================================
-- 1. profiles.title
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS title TEXT;

-- ============================================================
-- 2. member_titles — custom title vocabulary per account
-- ============================================================
CREATE TABLE IF NOT EXISTS member_titles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive uniqueness per account: "Sales" and "sales" are
-- the same vocabulary entry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_titles_account_name
  ON member_titles (account_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_member_titles_account
  ON member_titles (account_id);

ALTER TABLE member_titles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_titles_select ON member_titles;
DROP POLICY IF EXISTS member_titles_insert ON member_titles;
DROP POLICY IF EXISTS member_titles_update ON member_titles;
DROP POLICY IF EXISTS member_titles_delete ON member_titles;

-- Every member can read the vocabulary (pickers need it).
CREATE POLICY member_titles_select ON member_titles FOR SELECT USING (
  is_account_member(account_id)
);

-- Only admin+ curates the vocabulary.
CREATE POLICY member_titles_insert ON member_titles FOR INSERT WITH CHECK (
  is_account_member(account_id, 'admin')
);

CREATE POLICY member_titles_update ON member_titles FOR UPDATE USING (
  is_account_member(account_id, 'admin')
);

CREATE POLICY member_titles_delete ON member_titles FOR DELETE USING (
  is_account_member(account_id, 'admin')
);

-- ============================================================
-- 3. inbox_groups — custom inbox-group vocabulary per account
-- ============================================================
CREATE TABLE IF NOT EXISTS inbox_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_groups_account_name
  ON inbox_groups (account_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_inbox_groups_account
  ON inbox_groups (account_id);

ALTER TABLE inbox_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inbox_groups_select ON inbox_groups;
DROP POLICY IF EXISTS inbox_groups_insert ON inbox_groups;
DROP POLICY IF EXISTS inbox_groups_update ON inbox_groups;
DROP POLICY IF EXISTS inbox_groups_delete ON inbox_groups;

CREATE POLICY inbox_groups_select ON inbox_groups FOR SELECT USING (
  is_account_member(account_id)
);

CREATE POLICY inbox_groups_insert ON inbox_groups FOR INSERT WITH CHECK (
  is_account_member(account_id, 'admin')
);

CREATE POLICY inbox_groups_update ON inbox_groups FOR UPDATE USING (
  is_account_member(account_id, 'admin')
);

CREATE POLICY inbox_groups_delete ON inbox_groups FOR DELETE USING (
  is_account_member(account_id, 'admin')
);

-- ============================================================
-- 4. whatsapp_config.inbox_group — free-text group label
-- ============================================================
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS inbox_group TEXT;

-- ============================================================
-- 5. set_member_title RPC
--
-- profiles_update RLS is self-only, so (like set_member_role) a
-- SECURITY DEFINER RPC is the supervised write path for changing
-- *another* member's title. Titles are cosmetic: any member may be
-- given one (including the owner), and callers may set their own.
-- Only the caller's admin rank and same-account membership matter.
--
-- SQLSTATE contract (same as migration 018):
--   42501 insufficient_privilege  → 403
--   22023 invalid_parameter_value → 400
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_member_title(
  p_user_id UUID,
  p_title TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account UUID;
  v_caller_role account_role_enum;
  v_target_account UUID;
  v_title TEXT;
BEGIN
  -- Caller must be signed in.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
    INTO v_caller_account, v_caller_role
    FROM profiles
   WHERE user_id = auth.uid();

  IF v_caller_account IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Admin+ only (owner outranks admin in the rank mapping).
  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only admins can change member titles'
      USING ERRCODE = '42501';
  END IF;

  -- Target must be a member of the caller's account.
  SELECT account_id INTO v_target_account
    FROM profiles
   WHERE user_id = p_user_id;

  IF v_target_account IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account <> v_caller_account THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Normalise: trim, empty → NULL, hard length cap.
  v_title := NULLIF(btrim(COALESCE(p_title, '')), '');

  IF v_title IS NOT NULL AND char_length(v_title) > 60 THEN
    RAISE EXCEPTION 'Title must be 60 characters or fewer'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
     SET title = v_title
   WHERE user_id = p_user_id
     AND account_id = v_caller_account;
END;
$$;

ALTER FUNCTION public.set_member_title(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_title(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_title(UUID, TEXT) TO authenticated;
