import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig } from './types'
import { aiRequestTimeoutMs, resolveChatBaseUrl } from './defaults'
import { generateOpenAiCompatible } from './providers/openai-compatible'
import { generateAnthropic } from './providers/anthropic'

// ============================================================
// AI-powered contact profile enrichment.
//
// Called in the webhook's after() block for every inbound text
// message. The AI reads the conversation so far and extracts
// any contact details the customer mentioned explicitly. Results
// are applied only to fields that are currently blank — we never
// overwrite data the agent already entered.
// ============================================================

/** Shape the model is prompted to return. */
export interface ExtractedContactDetails {
  extracted_name: string | null
  extracted_email: string | null
  extracted_company: string | null
  intent_tags: string[]
  summary_note: string | null
}

/**
 * Regex-based email validation (RFC 5322 simplified subset).
 * Returns the email string if valid, null otherwise.
 */
export function validateEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  const EMAIL_RE = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/
  return EMAIL_RE.test(trimmed) ? trimmed : null
}

/**
 * Sanitise a name: strip leading/trailing whitespace, reject anything
 * that looks like a phone number, URL, or is suspiciously long (> 80 chars).
 */
export function sanitizeName(raw: string | null | undefined): string | null {
  if (!raw) return null
  const t = raw.trim()
  if (!t || t.length > 80) return null
  // Reject values that look like phone numbers or URLs
  if (/^[+\d\s\-()]{7,}$/.test(t)) return null
  if (/https?:\/\//i.test(t)) return null
  return t
}

/** Sanitise a company name similarly. */
export function sanitizeCompany(raw: string | null | undefined): string | null {
  if (!raw) return null
  const t = raw.trim()
  return t.length > 0 && t.length <= 120 ? t : null
}

/**
 * Parse and validate the raw JSON string the model returns.
 * Returns null when parsing fails or the model returns an obviously
 * invalid payload — the caller silently no-ops.
 */
export function parseExtractionResponse(raw: string): ExtractedContactDetails | null {
  try {
    // The model may wrap the JSON in a markdown code fence — strip it.
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()
    const parsed = JSON.parse(cleaned)
    if (typeof parsed !== 'object' || parsed === null) return null
    return {
      extracted_name: sanitizeName(parsed.extracted_name),
      extracted_email: validateEmail(parsed.extracted_email),
      extracted_company: sanitizeCompany(parsed.extracted_company),
      intent_tags: Array.isArray(parsed.intent_tags)
        ? (parsed.intent_tags as unknown[])
            .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
            .map((t) => t.trim())
            .slice(0, 10)
        : [],
      summary_note:
        typeof parsed.summary_note === 'string' && parsed.summary_note.trim()
          ? parsed.summary_note.trim().slice(0, 500)
          : null,
    }
  } catch {
    return null
  }
}

const EXTRACTION_SYSTEM_PROMPT = `You are a contact-detail extractor for a WhatsApp CRM.
Read the conversation below and extract ONLY information the customer stated explicitly.
Return a single JSON object — no markdown, no explanation — with exactly these keys:

{
  "extracted_name": "<full name the customer said they are, or null>",
  "extracted_email": "<email address the customer gave, or null>",
  "extracted_company": "<company or organisation the customer mentioned, or null>",
  "intent_tags": ["<tag1>", "<tag2>"],
  "summary_note": "<one concise sentence summarising what the customer wants, or null>"
}

Rules:
- Set a field to null if the customer did NOT explicitly state it — do not guess or infer.
- intent_tags should be short keyword labels (e.g. "Wholesale", "Refund Request", "New Order").
- Keep intent_tags to a maximum of 5 items.
- Return only the JSON object. Do not include any other text.`

/**
 * Call the AI to extract contact details from conversation messages.
 * Returns null on any failure (network, parse, etc.) — caller no-ops.
 */
export async function extractContactDetails(
  config: AiConfig,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<ExtractedContactDetails | null> {
  // We only need the customer-side text; include assistant turns for context
  // but make the transcript readable.
  if (messages.length === 0) return null

  const timeoutMs = Math.min(aiRequestTimeoutMs(), 20_000) // cap at 20s for enrichment
  const baseUrl = resolveChatBaseUrl(config)

  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    messages,
    timeoutMs,
    baseUrl,
    providerName: config.provider,
  }

  let raw: string
  try {
    if (config.provider === 'anthropic') {
      raw = await generateAnthropic(providerArgs)
    } else {
      raw = await generateOpenAiCompatible(providerArgs)
    }
  } catch {
    // Network / auth failures — don't surface; enrichment is best-effort.
    return null
  }

  return parseExtractionResponse(raw)
}

// ============================================================
// Contact completion checker
// ============================================================

/**
 * Checks if a contact profile is fully completed.
 * A profile is complete when it has a real name (not blank, not phone number),
 * a valid email, and a company.
 */
export function isContactComplete(contact: {
  phone?: string | null
  name?: string | null
  email?: string | null
  company?: string | null
}): boolean {
  const phoneVal = contact.phone ? contact.phone.trim() : ''
  const nameVal = contact.name ? contact.name.trim() : ''
  const emailVal = contact.email ? contact.email.trim() : ''
  const companyVal = contact.company ? contact.company.trim() : ''

  const hasRealName = nameVal !== '' && nameVal !== phoneVal
  const hasEmail = emailVal !== ''
  const hasCompany = companyVal !== ''

  return hasRealName && hasEmail && hasCompany
}

// ============================================================
// Database writer
// ============================================================

interface ExistingContact {
  id: string
  phone: string
  name: string | null
  email: string | null
  company: string | null
  user_id: string
  account_id: string
}

/**
 * Persist the extracted details to the database.
 *
 * Safety rules:
 *   - Never overwrite a field that already has a valid value — only fill gaps.
 *   - If name is equal to phone number, treat it as a placeholder and update.
 *   - Tags are upserted (idempotent); existing tags are untouched.
 *   - A summary note is inserted only when there is none yet for this contact.
 *   - `ai_enriched_at` is always stamped on success.
 */
export async function applyContactEnrichment(
  db: SupabaseClient,
  contact: ExistingContact,
  details: ExtractedContactDetails,
): Promise<void> {
  const now = new Date().toISOString()

  const isNameMissing =
    !contact.name || contact.name.trim() === '' || contact.name.trim() === contact.phone.trim()
  const isEmailMissing = !contact.email || contact.email.trim() === ''
  const isCompanyMissing = !contact.company || contact.company.trim() === ''

  // 1. Build the fields to patch — only fill missing details.
  const patch: Record<string, unknown> = { ai_enriched_at: now }

  if (details.extracted_name && isNameMissing) {
    patch.name = details.extracted_name
  }
  if (details.extracted_email && isEmailMissing) {
    patch.email = details.extracted_email
  }
  if (details.extracted_company && isCompanyMissing) {
    patch.company = details.extracted_company
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await db
      .from('contacts')
      .update({ ...patch, updated_at: now })
      .eq('id', contact.id)
    if (error) {
      console.error('[ai enrich] contacts update failed:', error.message)
    }
  }

  // 2. Upsert intent tags. Tags are account-scoped; find or create each,
  //    then link to the contact (idempotent via UNIQUE(contact_id, tag_id)).
  for (const tagName of details.intent_tags) {
    try {
      // Find existing tag (case-insensitive) or create it.
      const { data: existingTag } = await db
        .from('tags')
        .select('id')
        .eq('account_id', contact.account_id)
        .ilike('name', tagName)
        .maybeSingle()

      let tagId: string
      if (existingTag) {
        tagId = existingTag.id
      } else {
        const { data: newTag, error: tagErr } = await db
          .from('tags')
          .insert({
            account_id: contact.account_id,
            user_id: contact.user_id,
            name: tagName,
            color: '#8b5cf6', // violet — visually distinct from manually-created tags
          })
          .select('id')
          .single()
        if (tagErr || !newTag) continue
        tagId = newTag.id
      }

      // Link tag → contact (ignore conflict = already linked).
      await db
        .from('contact_tags')
        .upsert({ contact_id: contact.id, tag_id: tagId }, { onConflict: 'contact_id,tag_id' })
    } catch (err) {
      console.error('[ai enrich] tag upsert failed:', err)
    }
  }

  // 3. Insert a summary note if one was extracted and no note exists yet.
  if (details.summary_note) {
    const { count } = await db
      .from('contact_notes')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', contact.id)

    if ((count ?? 0) === 0) {
      const { error: noteErr } = await db.from('contact_notes').insert({
        contact_id: contact.id,
        user_id: contact.user_id,
        note_text: `[AI] ${details.summary_note}`,
      })
      if (noteErr) {
        console.error('[ai enrich] note insert failed:', noteErr.message)
      }
    }
  }
}

// ============================================================
// Main entry point — called from the webhook after() block.
// ============================================================

interface EnrichArgs {
  db: SupabaseClient
  accountId: string
  contactId: string
  conversationId: string
  config: AiConfig
}

/**
 * Top-level enrichment dispatcher. Owns its try/catch and never throws —
 * a failing enrichment call must never surface to the webhook caller.
 *
 * Eligibility gates (any → silent skip):
 *   - auto_enrich_contacts_enabled is false
 *   - AI master switch (is_active) is off — ensured by caller passing config
 *   - Contact profile details (name, email, company) are already fully extracted & saved
 *   - Conversation already has more messages than auto_enrich_max_messages
 */
export async function dispatchContactEnrichment(args: EnrichArgs): Promise<void> {
  const { db, accountId, contactId, conversationId, config } = args

  try {
    if (!config.autoEnrichContactsEnabled) return

    // Fetch the contact row to check which fields are missing.
    const { data: contact, error: contactErr } = await db
      .from('contacts')
      .select('id, phone, name, email, company, user_id, account_id')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (contactErr || !contact) return

    // Stop auto-enrichment as soon as all contact details are successfully completed & saved!
    if (isContactComplete(contact)) return


    // Check how many customer messages exist in this conversation.
    const { count: customerMsgCount } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')

    // Only enrich within the first N messages.
    if ((customerMsgCount ?? 0) > config.autoEnrichMaxMessages) return

    // Fetch recent messages (limit to 10 for context; extraction doesn't
    // need a long history — just enough for the customer to self-introduce).
    const { data: rawMessages, error: msgErr } = await db
      .from('messages')
      .select('sender_type, content_text')
      .eq('conversation_id', conversationId)
      .eq('content_type', 'text')
      .order('created_at', { ascending: false })
      .limit(10)

    if (msgErr || !rawMessages?.length) return

    const messages = (rawMessages as Array<{ sender_type: string; content_text: string | null }>)
      .reverse()
      .filter((m) => m.content_text?.trim())
      .map((m) => ({
        role: (m.sender_type === 'customer' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content_text!.trim(),
      }))

    if (messages.length === 0) return

    const details = await extractContactDetails(config, messages)
    if (!details) return

    // Nothing useful extracted — skip DB writes.
    const hasAnything =
      details.extracted_name ||
      details.extracted_email ||
      details.extracted_company ||
      details.intent_tags.length > 0 ||
      details.summary_note

    if (!hasAnything) return

    await applyContactEnrichment(db, contact, details)
  } catch (err) {
    console.error('[ai enrich] dispatchContactEnrichment failed:', err)
  }
}
