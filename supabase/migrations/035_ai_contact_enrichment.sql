-- ============================================================
-- 035_ai_contact_enrichment.sql
--
-- Extends the AI assistant with automatic contact detail extraction.
--
-- When an inbound WhatsApp message arrives, the AI engine analyses the
-- customer's text and fills in missing contact fields (name, email,
-- company) plus intent tags — all without blocking the webhook 200 OK.
--
-- New columns on ai_configs:
--   auto_enrich_contacts_enabled  — master switch; defaults on when the
--     account first configures the AI assistant (opt-out model).
--   auto_enrich_max_messages      — stop enriching after this many
--     inbound messages per conversation; keeps API spend bounded (default 5).
--
-- New column on contacts:
--   ai_enriched_at — timestamp of the last successful AI enrichment pass
--     so the Inbox can badge "AI Enriched" contacts and so we can
--     skip re-enriching contacts that are already fully populated.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ai_configs additions
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS auto_enrich_contacts_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS auto_enrich_max_messages integer NOT NULL DEFAULT 5
    CHECK (auto_enrich_max_messages BETWEEN 1 AND 20);

-- contacts addition
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS ai_enriched_at timestamptz;
