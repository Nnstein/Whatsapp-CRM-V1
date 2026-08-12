import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  testZidConnection,
  serializeZidCredentials,
  parseZidCredentials,
} from './client';

// Zid needs BOTH tokens, and they are different values:
//   authorization_token → Authorization: Bearer (app-level JWT)
//   access_token        → X-Manager-Token (per-store Manager Token)
const VALID_CREDS = {
  store_id: '10042',
  access_token: 'tok_manager',
  authorization_token: 'tok_jwt',
};

// ── testZidConnection ────────────────────────────────────────────

describe('testZidConnection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok:true with storeName on a 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ store: { name: 'My Shop' }, orders: [] }),
      }),
    );

    const result = await testZidConnection(VALID_CREDS);
    expect(result).toEqual({ ok: true, storeName: 'My Shop' });
  });

  it('sends the two tokens as DISTINCT headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ orders: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await testZidConnection(VALID_CREDS);

    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe('Bearer tok_jwt');
    expect(init.headers['X-Manager-Token']).toBe('tok_manager');
    expect(init.headers['Store-Id']).toBe('10042');
  });

  it('strips a user-pasted "Bearer " prefix from the authorization token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ orders: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await testZidConnection({
      ...VALID_CREDS,
      authorization_token: 'Bearer tok_jwt',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe('Bearer tok_jwt');
  });

  it('returns ok:true with no storeName when JSON lacks store field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ orders: [] }),
      }),
    );

    const result = await testZidConnection(VALID_CREDS);
    expect(result.ok).toBe(true);
    expect(result.storeName).toBeUndefined();
  });

  it('returns ok:false with a 401 hint mentioning both tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );

    const result = await testZidConnection(VALID_CREDS);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unauthorized/i);
    expect(result.error).toMatch(/both tokens/i);
  });

  it('returns ok:false with a 403 hint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403 }),
    );

    const result = await testZidConnection(VALID_CREDS);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/forbidden/i);
  });

  it('returns ok:false on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const result = await testZidConnection(VALID_CREDS);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/network error/i);
  });

  it('returns ok:false when credentials are empty', async () => {
    const result = await testZidConnection({ store_id: '', access_token: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it('returns ok:false with a specific error when the Authorization Token is missing', async () => {
    const result = await testZidConnection({
      store_id: '10042',
      access_token: 'tok_manager',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/authorization token is required/i);
  });

  it('returns ok:false with a specific error when the Manager Token is missing', async () => {
    const result = await testZidConnection({
      store_id: '10042',
      authorization_token: 'tok_jwt',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/manager token is required/i);
  });
});

// ── serializeZidCredentials / parseZidCredentials ────────────────

describe('serializeZidCredentials', () => {
  it('round-trips through parse', () => {
    const serialized = serializeZidCredentials(VALID_CREDS);
    const parsed = parseZidCredentials(serialized);
    expect(parsed.access_token).toBe('tok_manager');
    expect(parsed.authorization_token).toBe('tok_jwt');
    expect(parsed.store_id).toBe('10042');
  });
});

describe('parseZidCredentials', () => {
  it('parses legacy auth_token and manager_token into the distinct fields', () => {
    const legacy = JSON.stringify({ auth_token: 'auth', manager_token: 'mgr' });
    const parsed = parseZidCredentials(legacy);
    expect(parsed.access_token).toBe('mgr');
    expect(parsed.manager_token).toBe('mgr');
    expect(parsed.authorization_token).toBe('auth');
    expect(parsed.auth_token).toBe('auth');
  });

  it('parses a legacy single-token payload (no authorization token) without throwing', () => {
    const legacy = JSON.stringify({ store_id: '10042', access_token: 'tok_manager' });
    const parsed = parseZidCredentials(legacy);
    expect(parsed.access_token).toBe('tok_manager');
    expect(parsed.authorization_token).toBeUndefined();
  });

  it('throws on missing fields', () => {
    expect(() => parseZidCredentials(JSON.stringify({}))).toThrow();
  });
});
