-- ============================================================
-- 045_chat_import.sql — WhatsApp Chat History Importer
--
-- Adds provenance tracking to messages so historical imports
-- from the WhatsApp phone app can be visually distinguished
-- from live Cloud API messages in the inbox thread.
-- ============================================================

-- 1. Track message source (API, manual agent send, or imported)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS source text
  CHECK (source IN ('api', 'manual', 'imported_whatsapp'));

-- Default existing rows to 'api' (they all came from the Cloud API or were
-- agent-composed — the distinction between those two is covered by sender_type)
UPDATE messages SET source = 'api' WHERE source IS NULL;

-- 2. Flag conversations that have imported history so the UI can
--    insert the visual divider between imported and live messages.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS has_imported_history boolean NOT NULL DEFAULT false;

-- Index for efficient "find conversations with imported history" queries
CREATE INDEX IF NOT EXISTS conversations_has_imported_history_idx
  ON conversations (account_id, has_imported_history)
  WHERE has_imported_history = true;
