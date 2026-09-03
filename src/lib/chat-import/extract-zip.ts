// ============================================================
// extract-zip.ts — Server-side ZIP extraction helper
//
// Uses fflate (pure-JS, zero wasm) to decompress a WhatsApp
// chat export .zip in the Next.js API route (Node.js runtime).
//
// WhatsApp ZIP structure:
//   WhatsApp Chat with Name.zip
//   ├── _chat.txt                  (the transcript)
//   ├── IMG-20240103-WA0001.jpg    (images)
//   ├── VID-20240103-WA0002.mp4    (videos)
//   ├── PTT-20240103-WA0003.opus   (voice notes)
//   └── Invoice.pdf                (documents)
//
// The only file we guarantee exists is _chat.txt (or something
// that ends in -chat.txt). All media files are optional — the
// user may have exported "Without Media", giving us just the txt.
// ============================================================

import { unzipSync } from 'fflate';

export interface ExtractedZip {
  /** Raw text of the WhatsApp chat transcript. */
  chatText: string;
  /**
   * Map of original filename → raw bytes for each media file found
   * in the archive. Keys are basenames only (no path prefix).
   */
  mediaFiles: Map<string, Uint8Array>;
}

/**
 * Accepted transcript file suffixes (WhatsApp varies by locale/platform).
 */
const TRANSCRIPT_SUFFIXES = [
  '_chat.txt',
  '-chat.txt',
  ' chat.txt',
  '.txt',          // fallback: if there's only one .txt, use it
];

/**
 * Media file extensions we want to upload.
 * Anything else (e.g. .ini, .db) is silently skipped.
 */
const MEDIA_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp',           // images
  'mp4', '3gp', 'mov',                     // videos
  'opus', 'ogg', 'mp3', 'aac', 'm4a', 'amr', // audio
  'pdf', 'doc', 'docx', 'xls', 'xlsx',    // documents
  'ppt', 'pptx', 'txt',                   // more documents
]);

/**
 * Extract a WhatsApp .zip export.
 * Throws if no chat transcript is found in the archive.
 */
export function extractWhatsAppZip(zipBytes: Uint8Array): ExtractedZip {
  let decompressed: ReturnType<typeof unzipSync>;
  try {
    decompressed = unzipSync(zipBytes);
  } catch (err) {
    throw new Error(
      `Could not decompress the zip file: ${err instanceof Error ? err.message : 'unknown error'}. ` +
      'Ensure you uploaded a valid WhatsApp export.'
    );
  }

  // Collect all entries, stripping any top-level directory wrapper
  // (some platforms wrap everything inside a folder)
  const entries = Object.entries(decompressed).map(([path, bytes]) => ({
    path,
    basename: path.includes('/') ? path.split('/').pop()! : path,
    bytes,
  }));

  // ── Find the chat transcript ─────────────────────────────────
  let chatText: string | null = null;
  const txtEntries = entries.filter((e) => e.basename.endsWith('.txt'));

  // Try each known suffix in priority order
  for (const suffix of TRANSCRIPT_SUFFIXES) {
    const match = txtEntries.find((e) => e.basename.toLowerCase().endsWith(suffix));
    if (match) {
      chatText = new TextDecoder('utf-8').decode(match.bytes);
      break;
    }
  }

  // Ultimate fallback: if there's only one .txt file, use it
  if (!chatText && txtEntries.length === 1) {
    chatText = new TextDecoder('utf-8').decode(txtEntries[0].bytes);
  }

  if (!chatText) {
    throw new Error(
      'No WhatsApp chat transcript found in this zip. ' +
      'Expected a file ending in "_chat.txt". ' +
      'Please export the chat directly from WhatsApp.'
    );
  }

  // ── Collect media files ──────────────────────────────────────
  const mediaFiles = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.basename.endsWith('.txt')) continue; // skip transcripts
    const ext = entry.basename.split('.').pop()?.toLowerCase() ?? '';
    if (MEDIA_EXTENSIONS.has(ext)) {
      mediaFiles.set(entry.basename, entry.bytes);
    }
  }

  return { chatText, mediaFiles };
}
