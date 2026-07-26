import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  validateEmail,
  sanitizeName,
  sanitizeCompany,
  parseExtractionResponse,
  extractContactDetails,
  isContactComplete,
} from './extract-contact'
import type { AiConfig } from './types'



// ============================================================
// Pure validation helpers
// ============================================================

describe('validateEmail', () => {
  it('accepts a valid email and lowercases it', () => {
    expect(validateEmail('Alice@Example.COM')).toBe('alice@example.com')
  })

  it('returns null for null input', () => {
    expect(validateEmail(null)).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(validateEmail('')).toBeNull()
  })

  it('returns null for strings without @', () => {
    expect(validateEmail('notanemail')).toBeNull()
  })

  it('returns null for strings with no TLD', () => {
    expect(validateEmail('user@domain')).toBeNull()
  })
})

describe('sanitizeName', () => {
  it('trims whitespace', () => {
    expect(sanitizeName('  Alice Smith  ')).toBe('Alice Smith')
  })

  it('returns null for null', () => {
    expect(sanitizeName(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(sanitizeName('')).toBeNull()
  })

  it('rejects strings that look like phone numbers', () => {
    expect(sanitizeName('+234 801 234 5678')).toBeNull()
  })

  it('rejects strings longer than 80 chars', () => {
    expect(sanitizeName('A'.repeat(81))).toBeNull()
  })

  it('rejects URLs', () => {
    expect(sanitizeName('https://example.com')).toBeNull()
  })

  it('accepts a normal name', () => {
    expect(sanitizeName('Sarah Johnson')).toBe('Sarah Johnson')
  })
})

describe('sanitizeCompany', () => {
  it('accepts a normal company name', () => {
    expect(sanitizeCompany('Bellapierre Beauty')).toBe('Bellapierre Beauty')
  })

  it('returns null for empty string', () => {
    expect(sanitizeCompany('')).toBeNull()
  })

  it('returns null for strings > 120 chars', () => {
    expect(sanitizeCompany('A'.repeat(121))).toBeNull()
  })
})

describe('isContactComplete', () => {
  it('returns true when real name, email, and company are present', () => {
    expect(
      isContactComplete({
        phone: '+1234567890',
        name: 'Jane Doe',
        email: 'jane@example.com',
        company: 'Acme Corp',
      }),
    ).toBe(true)
  })

  it('returns false when name equals phone number', () => {
    expect(
      isContactComplete({
        phone: '+1234567890',
        name: '+1234567890',
        email: 'jane@example.com',
        company: 'Acme Corp',
      }),
    ).toBe(false)
  })

  it('returns false when email is missing', () => {
    expect(
      isContactComplete({
        phone: '+1234567890',
        name: 'Jane Doe',
        email: null,
        company: 'Acme Corp',
      }),
    ).toBe(false)
  })

  it('returns false when company is missing', () => {
    expect(
      isContactComplete({
        phone: '+1234567890',
        name: 'Jane Doe',
        email: 'jane@example.com',
        company: null,
      }),
    ).toBe(false)
  })
})

// ============================================================
// JSON response parser
// ============================================================

describe('parseExtractionResponse', () => {
  it('parses a well-formed JSON response', () => {
    const raw = JSON.stringify({
      extracted_name: 'Sarah',
      extracted_email: 'sarah@bellapierre.com',
      extracted_company: 'Bellapierre Beauty',
      intent_tags: ['Wholesale', 'Lipstick'],
      summary_note: 'Interested in bulk order.',
    })
    const result = parseExtractionResponse(raw)
    expect(result).toMatchObject({
      extracted_name: 'Sarah',
      extracted_email: 'sarah@bellapierre.com',
      extracted_company: 'Bellapierre Beauty',
      intent_tags: ['Wholesale', 'Lipstick'],
      summary_note: 'Interested in bulk order.',
    })
  })

  it('strips markdown code fences from the model output', () => {
    const raw = '```json\n{"extracted_name":"Bob","extracted_email":null,"extracted_company":null,"intent_tags":[],"summary_note":null}\n```'
    const result = parseExtractionResponse(raw)
    expect(result?.extracted_name).toBe('Bob')
  })

  it('returns null fields when the model returns null values', () => {
    const raw = JSON.stringify({
      extracted_name: null,
      extracted_email: null,
      extracted_company: null,
      intent_tags: [],
      summary_note: null,
    })
    const result = parseExtractionResponse(raw)
    expect(result?.extracted_name).toBeNull()
    expect(result?.extracted_email).toBeNull()
    expect(result?.intent_tags).toHaveLength(0)
  })

  it('returns null for malformed JSON', () => {
    expect(parseExtractionResponse('not json at all')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseExtractionResponse('')).toBeNull()
  })

  it('validates and rejects a bad email in the parsed result', () => {
    const raw = JSON.stringify({
      extracted_name: 'Bob',
      extracted_email: 'not-an-email',
      extracted_company: null,
      intent_tags: [],
      summary_note: null,
    })
    const result = parseExtractionResponse(raw)
    expect(result?.extracted_email).toBeNull()
  })

  it('limits intent_tags to 10 items', () => {
    const raw = JSON.stringify({
      extracted_name: null,
      extracted_email: null,
      extracted_company: null,
      intent_tags: Array.from({ length: 15 }, (_, i) => `tag-${i}`),
      summary_note: null,
    })
    const result = parseExtractionResponse(raw)
    expect(result?.intent_tags).toHaveLength(10)
  })

  it('strips non-string values from intent_tags', () => {
    const raw = JSON.stringify({
      extracted_name: null,
      extracted_email: null,
      extracted_company: null,
      intent_tags: ['Valid', 42, null, 'AlsoValid'],
      summary_note: null,
    })
    const result = parseExtractionResponse(raw)
    expect(result?.intent_tags).toEqual(['Valid', 'AlsoValid'])
  })

  it('truncates a very long summary_note to 500 chars', () => {
    const raw = JSON.stringify({
      extracted_name: null,
      extracted_email: null,
      extracted_company: null,
      intent_tags: [],
      summary_note: 'X'.repeat(600),
    })
    const result = parseExtractionResponse(raw)
    expect(result?.summary_note).toHaveLength(500)
  })
})

// ============================================================
// extractContactDetails — provider dispatch
// ============================================================

function makeConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    baseUrl: null,
    embeddingsBaseUrl: null,
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    embeddingsApiKey: null,
    autoEnrichContactsEnabled: true,
    autoEnrichMaxMessages: 5,
    ...overrides,
  }
}

function okFetch(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response)
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

describe('extractContactDetails', () => {
  it('returns null for an empty messages array', async () => {
    const result = await extractContactDetails(makeConfig(), [])
    expect(result).toBeNull()
  })

  it('calls the provider and parses the response', async () => {
    const payload = JSON.stringify({
      extracted_name: 'Alice',
      extracted_email: 'alice@test.com',
      extracted_company: 'Acme',
      intent_tags: ['Wholesale'],
      summary_note: 'Wants bulk pricing.',
    })
    vi.stubGlobal('fetch', okFetch(payload))

    const result = await extractContactDetails(makeConfig(), [
      { role: 'user', content: "Hi I'm Alice from Acme, alice@test.com" },
    ])

    expect(result).toMatchObject({
      extracted_name: 'Alice',
      extracted_email: 'alice@test.com',
      extracted_company: 'Acme',
      intent_tags: ['Wholesale'],
    })
  })

  it('returns null when the provider throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network fail')))

    const result = await extractContactDetails(makeConfig(), [
      { role: 'user', content: 'hello' },
    ])

    expect(result).toBeNull()
  })

  it('returns null when the model returns unparseable output', async () => {
    vi.stubGlobal('fetch', okFetch('Sorry, I cannot help with that.'))

    const result = await extractContactDetails(makeConfig(), [
      { role: 'user', content: 'hello' },
    ])

    expect(result).toBeNull()
  })

  it('uses the Anthropic adapter when provider is anthropic', async () => {
    const payload = JSON.stringify({
      extracted_name: 'Bob',
      extracted_email: null,
      extracted_company: null,
      intent_tags: [],
      summary_note: null,
    })
    // Anthropic API shape
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: payload }] }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const result = await extractContactDetails(
      makeConfig({ provider: 'anthropic' }),
      [{ role: 'user', content: "I'm Bob" }],
    )

    expect(result?.extracted_name).toBe('Bob')
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('anthropic.com')
  })
})
