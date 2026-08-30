-- ============================================================
-- 043_payment_connections.sql — Universal Payment Gateway Connector
--
-- Two tables that power in-chat payment link generation:
--
--   1. payment_connections  — one row per payment gateway per account.
--      Mirrors store_connections. Credentials stored AES-256-GCM encrypted.
--
--   2. payment_invoices     — one row per payment link created.
--      Tracks the invoice lifecycle from pending → paid/failed/expired.
--      Linked to whatsapp_carts for automatic cart confirmation on payment.
--
-- RLS mirrors store_connections:
--   SELECT — any member (agents need to know if a gateway is connected)
--   INSERT/UPDATE/DELETE — admin+ only
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. payment_connections
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_connections (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by            uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- 'myfatoorah', 'hesabe', 'generic', etc.
  connector_type        text        NOT NULL,

  -- Human-readable gateway name from the last successful test.
  gateway_label         text,

  is_active             boolean     NOT NULL DEFAULT true,

  -- AES-256-GCM encrypted JSON of the gateway's credential fields.
  -- NEVER returned to the client.
  credentials_encrypted text,

  last_tested_at        timestamptz,
  last_test_status      text        CHECK (last_test_status IN ('ok', 'error')),
  last_test_error       text,

  -- Stable random token (32 hex chars) used to scope the payment callback URL
  -- to this specific account+connection. Included in CallBackUrl as ?token=<secret>.
  webhook_secret        text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- One connection per gateway type per account.
  UNIQUE (account_id, connector_type)
);

ALTER TABLE payment_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_connections_select ON payment_connections;
CREATE POLICY payment_connections_select ON payment_connections FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS payment_connections_insert ON payment_connections;
CREATE POLICY payment_connections_insert ON payment_connections FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS payment_connections_update ON payment_connections;
CREATE POLICY payment_connections_update ON payment_connections FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS payment_connections_delete ON payment_connections;
CREATE POLICY payment_connections_delete ON payment_connections FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_payment_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_connections_updated_at ON payment_connections;
CREATE TRIGGER payment_connections_updated_at
  BEFORE UPDATE ON payment_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_payment_connections_updated_at();

-- Backfill webhook_secret for any rows already inserted before this migration.
UPDATE payment_connections
  SET webhook_secret = encode(gen_random_bytes(16), 'hex')
  WHERE webhook_secret IS NULL;

-- ────────────────────────────────────────────────────────────
-- 2. payment_invoices
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_invoices (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  payment_connection_id   uuid        NOT NULL REFERENCES payment_connections(id) ON DELETE CASCADE,

  -- The cart this invoice is associated with (nullable: manual invoices).
  cart_id                 uuid        REFERENCES whatsapp_carts(id) ON DELETE SET NULL,
  contact_id              uuid        REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id         uuid        REFERENCES conversations(id) ON DELETE SET NULL,

  -- Gateway-side identifiers.
  -- external_invoice_id: MyFatoorah InvoiceId, Hesabe invoice ref, etc.
  external_invoice_id     text,
  -- external_payment_id: set on callback after payment is made.
  external_payment_id     text,

  -- The payment link URL sent to the customer via WhatsApp.
  invoice_url             text,

  -- Financial snapshot at creation time.
  amount                  numeric(12,2) NOT NULL,
  currency                text        NOT NULL DEFAULT 'KWD',

  -- Lifecycle: pending → paid | failed | expired
  status                  text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'paid', 'failed', 'expired')),

  paid_at                 timestamptz,

  -- Raw gateway response payload for debugging / auditing.
  gateway_response        jsonb,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payment_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_invoices_select ON payment_invoices;
CREATE POLICY payment_invoices_select ON payment_invoices FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS payment_invoices_insert ON payment_invoices;
CREATE POLICY payment_invoices_insert ON payment_invoices FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS payment_invoices_update ON payment_invoices;
CREATE POLICY payment_invoices_update ON payment_invoices FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS payment_invoices_delete ON payment_invoices;
CREATE POLICY payment_invoices_delete ON payment_invoices FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_payment_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_invoices_updated_at ON payment_invoices;
CREATE TRIGGER payment_invoices_updated_at
  BEFORE UPDATE ON payment_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_payment_invoices_updated_at();
