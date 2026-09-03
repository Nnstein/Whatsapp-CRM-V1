-- ============================================================
-- 046_conversation_handling_mode.sql — Explicit AI/Human ownership
--
-- Adds `conversations.handling_mode` — the single source of truth for
-- WHO is expected to reply to the customer:
--
--   'ai'    (default) — the AI auto-reply bot handles inbound messages.
--   'human'           — a human agent owns the thread; the bot stands down.
--
-- Rules (enforced in application code, see src/lib/ai/auto-reply.ts):
--   - New conversations default to 'ai'.
--   - The bot hands off ('human') when the model emits [[HANDOFF]] or the
--     customer explicitly asks for a human (deterministic handoff-intent).
--   - Assigning an agent also silences the bot (assigned_agent_id check),
--     but assignment is transient; handling_mode is the sticky intent.
--   - A human flips back to 'ai' from the Inbox toggle, which also clears
--     the assignment and resets the per-conversation reply budget.
--
-- Replaces the implicit "ai_autoreply_disabled" flag as the gate. The old
-- column is kept for backwards compatibility and written in sync, but new
-- code reads handling_mode. Existing handed-off threads are backfilled.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS handling_mode text NOT NULL DEFAULT 'ai'
  CHECK (handling_mode IN ('ai', 'human'));

-- Backfill: conversations previously handed off / disabled stay human.
UPDATE conversations
  SET handling_mode = 'human'
  WHERE ai_autoreply_disabled = true
    AND handling_mode <> 'human';
