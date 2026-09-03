// ============================================================
// upload-import-media.ts
//
// Server-side media upload for the chat history importer.
//
// The browser's `uploadAccountMedia` (upload-media.ts) can't
// be used here because:
//   1. This runs in an API route, not the browser.
//   2. We need the admin client to bypass RLS on upload
//      (the import is authenticated at the route level;
//      the individual file objects don't have a session
//      cookie attached).
//
// Path convention: same account-scoped shape used by
// upload-media.ts and the chat-media bucket RLS policy:
//   chat-media/account-<account_id>/<timestamp>-<basename>.<ext>
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { buildMediaPath } from '@/lib/storage/upload-media';

/** Accepted MIME types for the chat-media bucket. */
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  mov: 'video/mp4',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  amr: 'audio/amr',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
};

/** Per-file size limit for imports — same 16 MB as the bucket. */
const MAX_FILE_BYTES = 16 * 1024 * 1024;

/**
 * Upload a single media file from a WhatsApp zip to the chat-media
 * Supabase Storage bucket using the service-role admin client.
 *
 * Returns the public URL on success, or null if the file should be
 * skipped (unsupported type, too large, or upload failed).
 */
export async function uploadImportedMedia(
  accountId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<string | null> {
  if (bytes.length > MAX_FILE_BYTES) {
    console.warn(`[import-media] Skipping ${filename}: too large (${bytes.length} bytes)`);
    return null;
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const contentType = MIME_BY_EXT[ext];
  if (!contentType) {
    console.warn(`[import-media] Skipping ${filename}: unsupported extension .${ext}`);
    return null;
  }

  const db = supabaseAdmin();
  const path = buildMediaPath(accountId, filename);

  const { error } = await db.storage
    .from('chat-media')
    .upload(path, bytes, {
      contentType,
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    console.warn(`[import-media] Upload failed for ${filename}:`, error.message);
    return null;
  }

  const { data: { publicUrl } } = db.storage.from('chat-media').getPublicUrl(path);
  return publicUrl;
}
