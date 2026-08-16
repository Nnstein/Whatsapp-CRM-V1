-- ============================================================
-- 041_universal_store_connector.sql — Phase 2 Universal Store Connector
--
-- Extends catalog_products, whatsapp_carts, and store_connections
-- to support universal store catalog sync, store-native checkout links,
-- and automated order webhooks.
--
-- Idempotent and safe to re-run.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. catalog_products additions
-- ────────────────────────────────────────────────────────────
ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS store_connection_id uuid REFERENCES store_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_product_id text;

CREATE UNIQUE INDEX IF NOT EXISTS catalog_products_store_external_id_idx
  ON catalog_products (store_connection_id, external_product_id)
  WHERE store_connection_id IS NOT NULL AND external_product_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 2. whatsapp_carts additions
-- ────────────────────────────────────────────────────────────
ALTER TABLE whatsapp_carts
  ADD COLUMN IF NOT EXISTS store_connection_id uuid REFERENCES store_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS store_checkout_url text;

-- ────────────────────────────────────────────────────────────
-- 3. store_connections additions
-- ────────────────────────────────────────────────────────────
ALTER TABLE store_connections
  ADD COLUMN IF NOT EXISTS sync_products_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_products_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_products_sync_status text,
  ADD COLUMN IF NOT EXISTS last_products_sync_error text,
  ADD COLUMN IF NOT EXISTS webhook_secret text;

-- Backfill a stable random webhook token for all existing connections.
-- New rows will have this set by the API on INSERT.
UPDATE store_connections
  SET webhook_secret = encode(gen_random_bytes(16), 'hex')
  WHERE webhook_secret IS NULL;
