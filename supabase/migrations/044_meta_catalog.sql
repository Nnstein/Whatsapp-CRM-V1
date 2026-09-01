-- ============================================================
-- 044_meta_catalog.sql — Meta Commerce Manager Catalog Integration
--
-- Enables native WhatsApp interactive product messages (single_product
-- and product_list) by linking WhatsApp numbers to a Meta Commerce
-- Manager Catalog ID and tracking catalog synchronization status.
-- ============================================================

-- 1. Add Meta Catalog ID to whatsapp_config
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS meta_catalog_id text;

-- 2. Add last sync timestamp to catalog_products
ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS meta_synced_at timestamptz;
