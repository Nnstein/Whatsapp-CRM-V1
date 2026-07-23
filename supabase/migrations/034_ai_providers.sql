-- ============================================================
-- 034_ai_providers.sql — Expand AI provider support
--
-- Adds base_url and embeddings_base_url columns to ai_configs,
-- drops the provider CHECK constraint to allow native presets
-- (google, xai, kimi, deepseek, openrouter, custom) and custom
-- OpenAI-compatible endpoints.
-- ============================================================

ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS base_url text;
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS embeddings_base_url text;

-- Drop the provider CHECK constraint if present so new provider names can be stored.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_configs_provider_check'
  ) THEN
    ALTER TABLE ai_configs DROP CONSTRAINT ai_configs_provider_check;
  END IF;
END $$;

-- Backfill existing rows with standard default base_url for openai.
UPDATE ai_configs
SET base_url = 'https://api.openai.com/v1'
WHERE provider = 'openai' AND base_url IS NULL;
