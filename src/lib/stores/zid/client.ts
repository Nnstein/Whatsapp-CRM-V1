/**
 * Zid store API client.
 *
 * Thin wrapper around the Zid REST API (`https://api.zid.sa/v1`).
 * Currently only implements `testConnection()` — the live ping used
 * by the "Test connection" button in Settings. Future additions
 * (orders, customers, products) belong here.
 *
 * Authentication
 * ──────────────
 * Every request requires two headers:
 *   Authorization  — the app-level Authorization Token
 *   X-Manager-Token — the per-store Manager Token
 *
 * Both tokens come from the Zid partner dashboard. They are stored
 * AES-256-GCM-encrypted in `store_connections.credentials_encrypted`
 * and decrypted server-side immediately before each call; they are
 * never sent to the client.
 */

import type { TestConnectionResult } from '../types';

const ZID_API_BASE = 'https://api.zid.sa/v1';

export interface ZidCredentials {
  store_id?: string;
  access_token?: string;
  auth_token?: string;
  manager_token?: string;
}

/**
 * Tests a Zid connection by fetching one order from the store.
 *
 * A 200 response (even an empty orders list) means the credentials
 * are valid and the store is reachable. Any non-2xx, network error,
 * or malformed response is treated as failure.
 */
export async function testZidConnection(
  credentials: ZidCredentials,
): Promise<TestConnectionResult> {
  const token = (credentials.access_token || credentials.auth_token || credentials.manager_token || '').trim();
  const storeId = (credentials.store_id || '').trim();

  if (!token) {
    return { ok: false, error: 'Access Token is required.' };
  }

  const headers: Record<string, string> = {
    Authorization: token,
    'X-Manager-Token': credentials.manager_token?.trim() || token,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (storeId) {
    headers['Store-Id'] = storeId;
  }

  let response: Response;
  try {
    response = await fetch(`${ZID_API_BASE}/managers/store/orders?page=1&per_page=1`, {
      method: 'GET',
      headers,
      // Fail fast — the UI awaits this on every button click.
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'TimeoutError'
        ? 'Request timed out — check your network or the Zid API status.'
        : `Network error: ${err instanceof Error ? err.message : String(err)}`;
    return { ok: false, error: message };
  }

  if (response.ok) {
    // Try to extract the store name from the response payload.
    // The Zid orders response wraps data in `{ store: { name }, orders: [] }`.
    let storeName: string | undefined;
    try {
      const body = await response.json();
      storeName =
        body?.store?.name ??
        body?.data?.store?.name ??
        undefined;
    } catch {
      // JSON parse failure is non-fatal for the connection test.
    }
    return { ok: true, storeName };
  }

  // Non-2xx — map common status codes to helpful messages.
  const statusMessages: Record<number, string> = {
    401: 'Unauthorized — check your Access Token.',
    403: 'Forbidden — check your Store ID or store permissions.',
    404: 'Store not found — verify your Store ID.',
    429: 'Rate limited by Zid — wait a moment and try again.',
  };

  const hint = statusMessages[response.status] ?? `Zid returned HTTP ${response.status}.`;
  return { ok: false, error: hint };
}

/**
 * Serialize Zid credentials to a JSON string for encryption.
 * Always call this before passing to `encrypt()`.
 */
export function serializeZidCredentials(credentials: ZidCredentials): string {
  return JSON.stringify(credentials);
}

/**
 * Parse the decrypted JSON string back into `ZidCredentials`.
 * Accepts store_id + access_token, or legacy auth_token + manager_token.
 */
export function parseZidCredentials(decrypted: string): ZidCredentials {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(decrypted) as Record<string, unknown>;
  } catch {
    // fallback if unparsed
  }

  const token = String(
    parsed.access_token || parsed.accessToken || parsed.auth_token || parsed.manager_token || ''
  ).trim();
  const storeId = String(parsed.store_id || parsed.storeId || '').trim();

  if (!token) {
    throw new Error('Invalid Zid credentials payload — missing access_token.');
  }

  return {
    store_id: storeId || undefined,
    access_token: token,
    auth_token: String(parsed.auth_token || token).trim(),
    manager_token: String(parsed.manager_token || token).trim(),
  };
}
