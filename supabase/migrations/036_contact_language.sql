-- ============================================================
-- 036_contact_language.sql — Multilingual Support (Gulf Arabic, Hindi, English)
-- ============================================================

-- Add language column to contacts table for AI auto-enrichment and targeted broadcasts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';

-- Index for fast language-segmented queries and broadcast filtering
CREATE INDEX IF NOT EXISTS idx_contacts_language ON contacts(account_id, language);
