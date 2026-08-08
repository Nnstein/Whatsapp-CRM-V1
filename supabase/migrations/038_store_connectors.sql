-- ============================================================
-- 038_store_connectors.sql — Modular store connectors
--
-- Adds the account-level config table for e-commerce store
-- integrations (Zid, Shopify, WooCommerce, …).
--
-- Design notes
--   - `store_connections` is account-scoped with a composite
--     UNIQUE(account_id, connector_type) constraint — one active
--     connection per connector type per workspace, exactly like
--     `whatsapp_config` (one row per phone number) or `ai_configs`
--     (one row per account).
--   - Credentials (`credentials_encrypted`) are stored as a single
--     AES-256-GCM-encrypted JSON blob (same `encrypt()`/`decrypt()`
--     helpers as `whatsapp_config.access_token` and
--     `ai_configs.api_key`). The plaintext JSON shape is
--     connector-specific (e.g. `{"auth_token":"…","manager_token":"…"}`
--     for Zid). The client never receives the raw credentials after
--     save — the settings UI shows a masked placeholder.
--   - `connector_type` is a free-form text column with no CHECK
--     constraint, mirroring the approach taken for `ai_configs.provider`
--     in migration 034 (dropped the CHECK so new connectors can be
--     registered without a schema change).
--   - `last_test_status` records the result of the most recent
--     "Test connection" ping: 'ok' | 'error'. NULL means never tested.
--   - `created_by` records who saved it (audit); ON DELETE SET NULL
--     so removing a teammate does not drop the workspace's connection.
--   - RLS mirrors `ai_configs` (settings-class):
--       SELECT — any member (viewer+) can read status so future
--         UI affordances (e.g. "Order history" on a contact) know
--         whether the store is connected.
--       INSERT / UPDATE / DELETE — admin+ only.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS store_connections (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by            uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- e.g. 'zid', 'shopify', 'woocommerce'
  connector_type        text        NOT NULL,

  -- AES-256-GCM-encrypted JSON blob of connector credentials.
  -- Shape is connector-specific; the lib/stores/<type>/client.ts
  -- module owns parsing after decryption.
  credentials_encrypted text        NOT NULL,

  -- Human-readable label returned by the store on a successful test
  -- (e.g. store name). NULL until the first successful test.
  store_label           text,

  is_active             boolean     NOT NULL DEFAULT true,

  last_tested_at        timestamptz,
  -- 'ok' | 'error' | NULL (never tested)
  last_test_status      text        CHECK (last_test_status IN ('ok', 'error')),
  last_test_error       text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- One connection per connector type per account.
  UNIQUE (account_id, connector_type)
);

ALTER TABLE store_connections ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the account (viewer+) — future UI panels
-- (e.g. contact order history) need to know whether a store is
-- connected without requiring admin access.
DROP POLICY IF EXISTS store_connections_select ON store_connections;
CREATE POLICY store_connections_select ON store_connections FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE / DELETE: admin+ only (settings-class).
DROP POLICY IF EXISTS store_connections_insert ON store_connections;
CREATE POLICY store_connections_insert ON store_connections FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS store_connections_update ON store_connections;
CREATE POLICY store_connections_update ON store_connections FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS store_connections_delete ON store_connections;
CREATE POLICY store_connections_delete ON store_connections FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Keep updated_at fresh on every write.
CREATE OR REPLACE FUNCTION public.update_store_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS store_connections_updated_at ON store_connections;
CREATE TRIGGER store_connections_updated_at
  BEFORE UPDATE ON store_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_store_connections_updated_at();
