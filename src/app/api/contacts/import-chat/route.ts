// ============================================================
// POST /api/contacts/import-chat
//
// Accepts a WhatsApp chat export (.txt OR .zip) via
// multipart/form-data, parses it, and bulk-inserts the
// historical messages into the database under a specific,
// verified contact.
//
// Phase 1 (.txt):  text messages only; media appears as
//   placeholder bubbles ([Photo], [Voice Note], [Document]).
//
// Phase 2 (.zip):  full media upload. The zip is extracted
//   with fflate, the _chat.txt transcript is parsed, and each
//   media file is uploaded to the chat-media Supabase Storage
//   bucket. Message rows get a real media_url instead of a
//   placeholder, so images/videos/audio render in the thread.
//
// Security model:
//   - Caller must be authenticated and a member of the account.
//   - The contact_id is required and validated against account_id
//     before any data is written.
//   - All inserted rows carry the account_id and are therefore
//     automatically scoped by existing RLS policies.
//
// Deduplication:
//   - Messages are skipped if a row with the same
//     (conversation_id, created_at, sender_type, content_text_prefix)
//     already exists — safe to re-import without creating duplicates.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account';
import { parseWhatsAppChat } from '@/lib/chat-import/parser';
import { extractWhatsAppZip } from '@/lib/chat-import/extract-zip';
import { uploadImportedMedia } from '@/lib/chat-import/upload-import-media';
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils';

// Maximum file sizes
const MAX_TXT_SIZE = 50 * 1024 * 1024;   // 50 MB for .txt
const MAX_ZIP_SIZE = 200 * 1024 * 1024;  // 200 MB for .zip (includes media)
// Chunk size for batch inserts — avoids hitting PostgREST body limits
const INSERT_CHUNK_SIZE = 500;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────
  let ctx: Awaited<ReturnType<typeof getCurrentAccount>>;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }
  const { accountId, userId } = ctx;

  // ── Parse multipart body ────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  const contactId = (formData.get('contact_id') as string | null)?.trim();
  const merchantName = (formData.get('merchant_name') as string | null)?.trim();
  const whatsappConfigId = (formData.get('whatsapp_config_id') as string | null)?.trim() || null;

  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  if (!contactId) return NextResponse.json({ error: 'contact_id is required' }, { status: 400 });
  if (!merchantName) return NextResponse.json({ error: 'merchant_name is required' }, { status: 400 });

  const filename = file.name ?? '';
  const isZip = filename.toLowerCase().endsWith('.zip');
  const isTxt = filename.toLowerCase().endsWith('.txt');

  if (!isZip && !isTxt) {
    return NextResponse.json(
      { error: 'Only .txt or .zip WhatsApp export files are supported.' },
      { status: 400 }
    );
  }

  const maxSize = isZip ? MAX_ZIP_SIZE : MAX_TXT_SIZE;
  if (file.size > maxSize) {
    return NextResponse.json(
      { error: `File too large. Maximum size is ${maxSize / 1024 / 1024} MB for ${isZip ? '.zip' : '.txt'} files.` },
      { status: 413 }
    );
  }

  // ── Validate contact belongs to this account ─────────────────
  const db = supabaseAdmin();

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone, phone_normalized, name')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (contactErr || !contact) {
    return NextResponse.json(
      { error: 'Contact not found or does not belong to your account' },
      { status: 404 }
    );
  }

  // ── Read file bytes & extract text ───────────────────────────
  let chatText: string;
  let mediaFiles: Map<string, Uint8Array> = new Map();

  try {
    if (isZip) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const extracted = extractWhatsAppZip(bytes);
      chatText = extracted.chatText;
      mediaFiles = extracted.mediaFiles;
    } else {
      chatText = await file.text();
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Could not read file';
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  if (!chatText.trim()) {
    return NextResponse.json({ error: 'No chat content found in the uploaded file' }, { status: 400 });
  }

  // ── Parse the transcript ─────────────────────────────────────
  const parsed = parseWhatsAppChat(chatText, merchantName);

  if (parsed.detectedFormat === 'unknown') {
    return NextResponse.json(
      {
        error:
          'Could not detect a valid WhatsApp export format. ' +
          'Please export the chat directly from WhatsApp (More options → Export Chat) ' +
          'and upload the resulting .txt or .zip file.',
      },
      { status: 422 }
    );
  }

  if (parsed.messages.length === 0) {
    return NextResponse.json(
      { error: 'No messages found in the file after filtering system messages.' },
      { status: 422 }
    );
  }

  // ── Optional: phone validation from filename ─────────────────
  const phoneInFilename = filename.match(/(\+?\d[\d\s\-().]{6,20})/)?.[1];
  if (phoneInFilename) {
    const filePhone = normalizePhone(phoneInFilename);
    const contactPhone = normalizePhone(contact.phone);
    if (
      filePhone.length >= 7 &&
      contactPhone.length >= 7 &&
      !phonesMatch(filePhone, contactPhone)
    ) {
      return NextResponse.json(
        {
          error:
            `Phone number mismatch: the filename suggests this chat belongs to ${phoneInFilename}, ` +
            `but the selected contact has phone ${contact.phone}. ` +
            'Please ensure you upload the correct chat file for this contact.',
        },
        { status: 409 }
      );
    }
  }

  // ── Phase 2: upload media files ──────────────────────────────
  // Build a map of original filename → public URL for messages
  // whose mediaFilename matches a file found in the zip.
  const uploadedMediaUrls = new Map<string, string>();

  if (mediaFiles.size > 0) {
    // Upload all media files concurrently (batched to avoid overwhelming the API)
    const UPLOAD_CONCURRENCY = 5;
    const mediaEntries = Array.from(mediaFiles.entries());

    for (let i = 0; i < mediaEntries.length; i += UPLOAD_CONCURRENCY) {
      const batch = mediaEntries.slice(i, i + UPLOAD_CONCURRENCY);
      await Promise.all(
        batch.map(async ([mediaFilename, bytes]) => {
          const url = await uploadImportedMedia(accountId, mediaFilename, bytes);
          if (url) uploadedMediaUrls.set(mediaFilename, url);
        })
      );
    }
  }

  // ── Resolve or create conversation ───────────────────────────
  let resolvedConfigId: string | null = null;

  if (whatsappConfigId) {
    const { data: cfg } = await db
      .from('whatsapp_config')
      .select('id')
      .eq('id', whatsappConfigId)
      .eq('account_id', accountId)
      .maybeSingle();
    resolvedConfigId = cfg?.id ?? null;
  }

  if (!resolvedConfigId) {
    const { data: defaultCfg } = await db
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_default', true)
      .maybeSingle();
    resolvedConfigId = defaultCfg?.id ?? null;
  }

  if (!resolvedConfigId) {
    const { data: anyCfg } = await db
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .limit(1)
      .maybeSingle();
    resolvedConfigId = anyCfg?.id ?? null;
  }

  if (!resolvedConfigId) {
    return NextResponse.json(
      { error: 'No WhatsApp number configured. Please add one in Settings → WhatsApp.' },
      { status: 400 }
    );
  }

  // Find or create the conversation
  let conversationId: string;

  const { data: existingConv } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('whatsapp_config_id', resolvedConfigId)
    .maybeSingle();

  if (existingConv?.id) {
    conversationId = existingConv.id;
  } else {
    const { data: newConv, error: convErr } = await db
      .from('conversations')
      .insert({
        account_id: accountId,
        user_id: userId,
        contact_id: contactId,
        whatsapp_config_id: resolvedConfigId,
        status: 'open',
      })
      .select('id')
      .single();

    if (convErr || !newConv) {
      console.error('[import-chat] conversation create error:', convErr);
      return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
    }
    conversationId = newConv.id;
  }

  // Mark conversation as having imported history
  await db
    .from('conversations')
    .update({ has_imported_history: true })
    .eq('id', conversationId);

  // ── Deduplication set ────────────────────────────────────────
  const { data: existingMessages } = await db
    .from('messages')
    .select('created_at, sender_type, content_text')
    .eq('conversation_id', conversationId)
    .eq('source', 'imported_whatsapp');

  const existingSet = new Set<string>();
  for (const m of existingMessages ?? []) {
    const key = `${m.created_at}|${m.sender_type}|${(m.content_text ?? '').slice(0, 80)}`;
    existingSet.add(key);
  }

  // ── Build insert rows ────────────────────────────────────────
  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  let mediaLinked = 0;

  for (const msg of parsed.messages) {
    const senderType = msg.isOutbound ? 'agent' : 'customer';
    const createdAt = isNaN(msg.timestamp.getTime())
      ? new Date().toISOString()
      : msg.timestamp.toISOString();

    // Resolve media URL if this message has a media attachment
    // and we successfully uploaded the file from the zip
    let mediaUrl: string | null = null;
    let contentText = msg.contentText ?? null;

    if (msg.mediaFilename && uploadedMediaUrls.has(msg.mediaFilename)) {
      mediaUrl = uploadedMediaUrls.get(msg.mediaFilename)!;
      // Clear the placeholder text when we have a real URL
      contentText = null;
      mediaLinked++;
    }

    const dedupKey = `${createdAt}|${senderType}|${(contentText ?? '').slice(0, 80)}`;
    if (existingSet.has(dedupKey)) {
      skipped++;
      continue;
    }
    existingSet.add(dedupKey);

    rows.push({
      conversation_id: conversationId,
      account_id: accountId,
      user_id: userId,
      sender_type: senderType,
      content_type: msg.contentType === 'audio'
        ? 'audio'
        : msg.contentType === 'video'
        ? 'video'
        : msg.contentType === 'document'
        ? 'document'
        : msg.contentType === 'image'
        ? 'image'
        : 'text',
      content_text: contentText,
      media_url: mediaUrl,
      status: senderType === 'agent' ? 'sent' : 'delivered',
      source: 'imported_whatsapp',
      created_at: createdAt,
    });
  }

  // ── Batch insert ─────────────────────────────────────────────
  let imported = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
    const { error: insertErr } = await db.from('messages').insert(chunk);
    if (insertErr) {
      console.error('[import-chat] message insert error:', insertErr);
      return NextResponse.json(
        { error: `Failed to import messages (batch ${i}): ${insertErr.message}` },
        { status: 500 }
      );
    }
    imported += chunk.length;
  }

  // ── Update conversation's last message pointer ────────────────
  if (rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    await db
      .from('conversations')
      .update({
        last_message_text: (lastRow.content_text as string | null) ?? '[Media]',
        last_message_at: lastRow.created_at as string,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
  }

  return NextResponse.json({
    ok: true,
    imported,
    skipped,
    total: parsed.messages.length,
    media_uploaded: uploadedMediaUrls.size,
    media_linked: mediaLinked,
    conversation_id: conversationId,
    detected_format: parsed.detectedFormat,
    phase: isZip && mediaFiles.size > 0 ? 2 : 1,
  });
}
