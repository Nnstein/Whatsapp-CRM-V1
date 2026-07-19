-- ============================================================
-- Migration: Add window_expires_at to conversations
--
-- Tracks the WhatsApp 24-hour customer service window.
-- When a customer messages us, the window opens for 24 hours
-- during which we can send free-form messages. After expiry,
-- only pre-approved templates can be sent.
--
-- The webhook updates this on every inbound customer message:
--   window_expires_at = NOW() + INTERVAL '24 hours'
--
-- The UI uses this column to show:
--   - Green indicator: window is open (within 24h of last customer msg)
--   - Red indicator: window expired, templates only
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS window_expires_at TIMESTAMPTZ;

-- Index for fast querying of expired vs open windows
CREATE INDEX IF NOT EXISTS idx_conversations_window_expires
  ON conversations (window_expires_at)
  WHERE window_expires_at IS NOT NULL;

-- Backfill: set window_expires_at based on last customer message for
-- existing conversations. We look at the messages table for each
-- conversation's last customer-sent message.
UPDATE conversations c
SET window_expires_at = m.last_customer_at + INTERVAL '24 hours'
FROM (
  SELECT conversation_id, MAX(created_at) AS last_customer_at
  FROM messages
  WHERE sender_type = 'customer'
  GROUP BY conversation_id
) m
WHERE c.id = m.conversation_id
  AND c.window_expires_at IS NULL;
