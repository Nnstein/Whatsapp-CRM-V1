import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig, AiProvider } from './types'

interface AiConfigRow {
  provider: AiProvider
  model: string
  api_key: string
  base_url?: string | null
  embeddings_base_url?: string | null
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  embeddings_api_key: string | null
}

const CONFIG_COLUMNS =
  'provider, model, api_key, base_url, embeddings_base_url, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, embeddings_api_key'

const FALLBACK_COLUMNS =
  'provider, model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, embeddings_api_key'

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {},
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  let { data, error } = await db
    .from('ai_configs')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()

  // Defensive: if migration 034 hasn't been executed on the DB yet, fall back cleanly.
  if (error && (error.code === '42703' || error.message?.includes('base_url'))) {
    const res = await db
      .from('ai_configs')
      .select(FALLBACK_COLUMNS)
      .eq('account_id', accountId)
      .maybeSingle()
    data = res.data ? ({ ...res.data, base_url: null, embeddings_base_url: null } as unknown as typeof data) : null
    error = res.error
  }

  if (error) throw error
  if (!data) return null

  const row = data as AiConfigRow
  if (requireActive && !row.is_active) return null
  if (!row.api_key) return null

  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  return {
    provider: row.provider,
    model: row.model,
    apiKey: decrypt(row.api_key),
    baseUrl: row.base_url ?? null,
    embeddingsBaseUrl: row.embeddings_base_url ?? null,
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    embeddingsApiKey,
  }
}

/**
 * Load + decrypt just the embeddings key & base URLs, independent of `is_active`.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
): Promise<{
  key: string | null
  corrupt: boolean
  provider?: AiProvider
  baseUrl?: string | null
  embeddingsBaseUrl?: string | null
}> {
  let { data, error } = await db
    .from('ai_configs')
    .select('provider, base_url, embeddings_base_url, embeddings_api_key')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error && (error.code === '42703' || error.message?.includes('base_url'))) {
    const res = await db
      .from('ai_configs')
      .select('provider, embeddings_api_key')
      .eq('account_id', accountId)
      .maybeSingle()
    data = res.data ? ({ ...res.data, base_url: null, embeddings_base_url: null } as unknown as typeof data) : null
    error = res.error
  }

  if (error || !data) {
    return { key: null, corrupt: false }
  }

  const provider = data.provider as AiProvider
  const baseUrl = (data as { base_url?: string | null }).base_url ?? null
  const embeddingsBaseUrl = (data as { embeddings_base_url?: string | null }).embeddings_base_url ?? null

  if (!data.embeddings_api_key) {
    return { key: null, corrupt: false, provider, baseUrl, embeddingsBaseUrl }
  }

  try {
    return {
      key: decrypt(data.embeddings_api_key),
      corrupt: false,
      provider,
      baseUrl,
      embeddingsBaseUrl,
    }
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true, provider, baseUrl, embeddingsBaseUrl }
  }
}
