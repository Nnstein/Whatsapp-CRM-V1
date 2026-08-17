-- ============================================================
-- 042_webhook_signing_secret.sql — HMAC signature verification
--
-- Adds an optional signing_secret to store_connections. When set,
-- the public store webhook endpoint requires a valid
-- X-WACRM-Signature: sha256=<hmac-hex> header computed over the
-- raw request body with this secret. When NULL, the ?token= URL
-- secret alone authenticates the request (backwards compatible).
--
-- Idempotent and safe to re-run.
-- ============================================================

ALTER TABLE store_connections
  ADD COLUMN IF NOT EXISTS signing_secret text;
