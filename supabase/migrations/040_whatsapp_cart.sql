-- ============================================================
-- 040_whatsapp_cart.sql — WhatsApp Cart (Phase 1)
--
-- Three tables that together power the in-WhatsApp shopping cart:
--
--   1. catalog_products  — the account's hand-entered product catalog.
--      Products are created/edited in Settings → Catalog. The AI
--      auto-reply and the cart-intent classifier both query this table
--      to answer "what do you sell?" and "add X to my cart".
--
--   2. whatsapp_carts    — one open cart per contact per account.
--      Created automatically the first time a contact adds an item.
--      The lifecycle is:
--        open → checkout_sent → confirmed
--               ↘ cancelled
--
--   3. whatsapp_cart_items — line items inside a cart.
--      Snapshots product name and price at the moment of add so
--      the cart stays consistent even if the merchant later edits
--      the catalog.
--
-- Also adds `accounts.payment_instructions` (text, nullable) — the
-- free-text payment template the merchant edits once in Settings and
-- the checkout flow pre-fills (e.g. "STC Pay: 0501234567").
--
-- Design notes
--   - RLS mirrors ai_configs / store_connections (settings-class):
--       catalog SELECT  — any member (agents browse the catalog)
--       catalog CRUD    — admin+ only
--       carts SELECT    — any member (agents view cart in inbox)
--       carts INSERT    — any agent+ (bot creates carts)
--       carts UPDATE    — any agent+ (add items, send checkout)
--       carts DELETE    — admin+ only
--       cart_items CRUD — cascades from carts (no separate policy)
--   - updated_at managed by a single generic function per table.
--   - Idempotent — safe to run multiple times.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. accounts.payment_instructions
-- ────────────────────────────────────────────────────────────
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS payment_instructions text;

-- ────────────────────────────────────────────────────────────
-- 2. catalog_products
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog_products (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  sku          text,
  name         text        NOT NULL,
  description  text,

  price        numeric(12,2) NOT NULL DEFAULT 0,
  sale_price   numeric(12,2),
  cost         numeric(12,2),
  currency     text        NOT NULL DEFAULT 'SAR',

  -- Stock / Inventory count, e.g. 'Infinite', '0', '11'
  quantity     text        NOT NULL DEFAULT 'Infinite',

  -- Category tags, e.g. ['Face', 'Makeup Essentials']
  categories   text[]      NOT NULL DEFAULT '{}',

  -- Public URL served to WhatsApp (Supabase Storage public bucket or external CDN)
  image_url    text,
  images       text[]      NOT NULL DEFAULT '{}',

  weight       numeric     DEFAULT 0,
  weight_unit  text        DEFAULT 'kg',

  has_variants boolean     NOT NULL DEFAULT false,

  -- JSON array of variant objects
  variants     jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- Free-form tags for search / AI context
  tags         text[]      NOT NULL DEFAULT '{}',

  is_active    boolean     NOT NULL DEFAULT true,

  -- 0-based; smaller values sort first in the catalog grid
  sort_order   integer     NOT NULL DEFAULT 0,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Ensure columns exist for tables already created
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS quantity text NOT NULL DEFAULT 'Infinite';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS weight numeric DEFAULT 0;
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS weight_unit text DEFAULT 'kg';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS cost numeric(12,2);
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS sale_price numeric(12,2);
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS has_variants boolean NOT NULL DEFAULT false;

ALTER TABLE catalog_products ENABLE ROW LEVEL SECURITY;

-- SELECT: any account member (agents need to browse the catalog)
DROP POLICY IF EXISTS catalog_products_select ON catalog_products;
CREATE POLICY catalog_products_select ON catalog_products FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE / DELETE: admin+ only (same as ai_configs)
DROP POLICY IF EXISTS catalog_products_insert ON catalog_products;
CREATE POLICY catalog_products_insert ON catalog_products FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS catalog_products_update ON catalog_products;
CREATE POLICY catalog_products_update ON catalog_products FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS catalog_products_delete ON catalog_products;
CREATE POLICY catalog_products_delete ON catalog_products FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_catalog_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS catalog_products_updated_at ON catalog_products;
CREATE TRIGGER catalog_products_updated_at
  BEFORE UPDATE ON catalog_products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_catalog_products_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. whatsapp_carts
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_carts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id      uuid        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  -- The last conversation that touched the cart (for routing the
  -- checkout message back to the right WhatsApp thread).
  conversation_id uuid        REFERENCES conversations(id) ON DELETE SET NULL,

  -- 'open'           — items can be added/removed
  -- 'checkout_sent'  — payment instruction was sent via WhatsApp
  -- 'confirmed'      — admin marked the order as received
  -- 'cancelled'      — cart was cleared / abandoned
  status          text        NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'checkout_sent', 'confirmed', 'cancelled')),

  -- The payment instruction text that was sent (snapshot of
  -- accounts.payment_instructions at send time, optionally edited
  -- per-checkout by the agent).
  checkout_note   text,

  -- Future: filled by Phase 2 store webhook after Zid/Salla confirm.
  store_order_id  text,

  confirmed_at    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One open cart per contact per account. Multiple completed carts are
-- allowed (order history). The UNIQUE index covers only 'open' status.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_carts_one_open_per_contact
  ON whatsapp_carts (account_id, contact_id)
  WHERE status = 'open';

ALTER TABLE whatsapp_carts ENABLE ROW LEVEL SECURITY;

-- SELECT: any account member
DROP POLICY IF EXISTS whatsapp_carts_select ON whatsapp_carts;
CREATE POLICY whatsapp_carts_select ON whatsapp_carts FOR SELECT
  USING (is_account_member(account_id));

-- INSERT: agent+ (the cart-intent bot creates carts)
DROP POLICY IF EXISTS whatsapp_carts_insert ON whatsapp_carts;
CREATE POLICY whatsapp_carts_insert ON whatsapp_carts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

-- UPDATE: agent+ (add items, send checkout, confirm)
DROP POLICY IF EXISTS whatsapp_carts_update ON whatsapp_carts;
CREATE POLICY whatsapp_carts_update ON whatsapp_carts FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

-- DELETE: admin+ only
DROP POLICY IF EXISTS whatsapp_carts_delete ON whatsapp_carts;
CREATE POLICY whatsapp_carts_delete ON whatsapp_carts FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_whatsapp_carts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS whatsapp_carts_updated_at ON whatsapp_carts;
CREATE TRIGGER whatsapp_carts_updated_at
  BEFORE UPDATE ON whatsapp_carts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_whatsapp_carts_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. whatsapp_cart_items
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_cart_items (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id        uuid        NOT NULL REFERENCES whatsapp_carts(id) ON DELETE CASCADE,

  -- Nullable: the product may be soft-deleted after it was added.
  -- The name/price snapshots below are the source of truth.
  product_id     uuid        REFERENCES catalog_products(id) ON DELETE SET NULL,

  -- Snapshot at the moment of add — survives product edits/deletes.
  product_name   text        NOT NULL,
  product_price  numeric(12,2) NOT NULL,
  variant_label  text,

  quantity       integer     NOT NULL DEFAULT 1 CHECK (quantity > 0),

  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Items inherit their account via cart_id → whatsapp_carts.account_id.
-- RLS on whatsapp_carts is sufficient because every items query must
-- join through a cart the caller can already SELECT/UPDATE.
-- We still need RLS enabled for the table itself.
ALTER TABLE whatsapp_cart_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_cart_items_select ON whatsapp_cart_items;
CREATE POLICY whatsapp_cart_items_select ON whatsapp_cart_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM whatsapp_carts c
      WHERE c.id = whatsapp_cart_items.cart_id
        AND is_account_member(c.account_id)
    )
  );

DROP POLICY IF EXISTS whatsapp_cart_items_insert ON whatsapp_cart_items;
CREATE POLICY whatsapp_cart_items_insert ON whatsapp_cart_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM whatsapp_carts c
      WHERE c.id = whatsapp_cart_items.cart_id
        AND is_account_member(c.account_id, 'agent')
    )
  );

DROP POLICY IF EXISTS whatsapp_cart_items_update ON whatsapp_cart_items;
CREATE POLICY whatsapp_cart_items_update ON whatsapp_cart_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM whatsapp_carts c
      WHERE c.id = whatsapp_cart_items.cart_id
        AND is_account_member(c.account_id, 'agent')
    )
  );

DROP POLICY IF EXISTS whatsapp_cart_items_delete ON whatsapp_cart_items;
CREATE POLICY whatsapp_cart_items_delete ON whatsapp_cart_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM whatsapp_carts c
      WHERE c.id = whatsapp_cart_items.cart_id
        AND is_account_member(c.account_id, 'agent')
    )
  );
