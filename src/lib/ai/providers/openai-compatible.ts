import { AiError } from '../types'
import { MAX_OUTPUT_TOKENS, normalizeBaseUrl } from '../defaults'
import {
  mergeConsecutive,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

interface OpenAiResponse {
  choices?: { message?: { content?: string } }[]
}

/**
 * Call any OpenAI-compatible Chat Completions endpoint with the caller's own key and base URL.
 * Works with OpenAI, Gemini, Grok, Kimi, DeepSeek, OpenRouter, Groq, Ollama, vLLM, etc.
 */
export async function generateOpenAiCompatible(
  args: ProviderArgs,
): Promise<string> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, baseUrl, providerName } = args

  const rootUrl = normalizeBaseUrl(baseUrl) || DEFAULT_OPENAI_BASE_URL
  let endpoint = `${rootUrl}/chat/completions`
  const displayName = providerName || 'AI Provider'

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  // Add OpenRouter specific headers if targeting OpenRouter
  if (rootUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = process.env.NEXT_PUBLIC_SITE_URL || 'https://wacrm.app'
    headers['X-Title'] = 'wacrm WhatsApp CRM'
  }

  // Google AI Studio (Gemini) compatibility: pass API key in query param & header
  if (rootUrl.includes('generativelanguage.googleapis.com')) {
    headers['x-goog-api-key'] = apiKey
    if (!endpoint.includes('key=')) {
      endpoint += `?key=${encodeURIComponent(apiKey)}`
    }
  }

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...mergeConsecutive(messages),
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError(displayName, res)
  }

  const data = (await res.json().catch(() => null)) as OpenAiResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError(`${displayName} returned an empty response.`, {
      code: 'empty_response',
    })
  }
  return text
}
