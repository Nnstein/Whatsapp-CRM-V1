-- ============================================================
-- 037_account_branding.sql
--
-- Adds per-account logo_url and a public "logos" storage bucket
-- so businesses can replace the fixed sidebar brand with their
-- own logo + business name.
-- ============================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- ------------------------------------------------------------
-- Storage bucket for account logos
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'logos',
  'logos',
  TRUE,
  2097152, -- 2 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read so the sidebar <img> can render without signed URLs.
DROP POLICY IF EXISTS "Logos are publicly readable" ON storage.objects;
CREATE POLICY "Logos are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'logos');

-- Writes are restricted to admin+ members of the account that owns
-- the path. The app uses paths like: logos/{account_id}/logo-{ts}.ext
DROP POLICY IF EXISTS "Account admins can upload logos" ON storage.objects;
CREATE POLICY "Account admins can upload logos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'logos'
    AND is_account_member((storage.foldername(name))[1]::uuid, 'admin')
  );

DROP POLICY IF EXISTS "Account admins can update their logo" ON storage.objects;
CREATE POLICY "Account admins can update their logo"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'logos'
    AND is_account_member((storage.foldername(name))[1]::uuid, 'admin')
  );

DROP POLICY IF EXISTS "Account admins can delete their logo" ON storage.objects;
CREATE POLICY "Account admins can delete their logo"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'logos'
    AND is_account_member((storage.foldername(name))[1]::uuid, 'admin')
  );
