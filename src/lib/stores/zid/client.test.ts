import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  testZidConnection,
  serializeZidCredentials,
  parseZidCredentials,
} from './client';

const VALID_CREDS = { auth_token: 'tok_auth', manager_token: 'tok_mgr' };

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

  it('returns ok:false with a 401 hint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );

    const result = await testZidConnection(VALID_CREDS);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unauthorized/i);
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
    const result = await testZidConnection({ auth_token: '', manager_token: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/required/i);
  });
});

// ── serializeZidCredentials / parseZidCredentials ────────────────

describe('serializeZidCredentials', () => {
  it('round-trips through parse', () => {
    const serialized = serializeZidCredentials(VALID_CREDS);
    expect(parseZidCredentials(serialized)).toEqual(VALID_CREDS);
  });
});

describe('parseZidCredentials', () => {
  it('throws on missing fields', () => {
    expect(() => parseZidCredentials(JSON.stringify({ auth_token: 'x' }))).toThrow();
    expect(() => parseZidCredentials(JSON.stringify({}))).toThrow();
  });
});
