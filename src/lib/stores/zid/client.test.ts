import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  testZidConnection,
  serializeZidCredentials,
  parseZidCredentials,
} from './client';

const VALID_CREDS = { store_id: '10042', access_token: 'tok_access' };

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
    const result = await testZidConnection({ store_id: '', access_token: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/required/i);
  });
});

// ── serializeZidCredentials / parseZidCredentials ────────────────

describe('serializeZidCredentials', () => {
  it('round-trips through parse', () => {
    const serialized = serializeZidCredentials(VALID_CREDS);
    const parsed = parseZidCredentials(serialized);
    expect(parsed.access_token).toBe('tok_access');
    expect(parsed.store_id).toBe('10042');
  });
});

describe('parseZidCredentials', () => {
  it('parses legacy auth_token and manager_token', () => {
    const legacy = JSON.stringify({ auth_token: 'auth', manager_token: 'mgr' });
    const parsed = parseZidCredentials(legacy);
    expect(parsed.access_token).toBe('auth');
    expect(parsed.auth_token).toBe('auth');
    expect(parsed.manager_token).toBe('mgr');
  });

  it('throws on missing fields', () => {
    expect(() => parseZidCredentials(JSON.stringify({}))).toThrow();
  });
});
