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
  auth_token: string;
  manager_token: string;
}

/**
 * Tests a Zid connection by fetching one order from the store.
 *
 * A 200 response (even an empty orders list) means the credentials
 * are valid and the store is reachable. Any non-2xx, network error,
 * or malformed response is treated as failure.
 *
 * We use `GET /managers/store/orders?page=1&per_page=1` because it
 * is the lightest authenticated endpoint: it costs one small JSON
 * payload and does not mutate any store data.
 */
export async function testZidConnection(
  credentials: ZidCredentials,
): Promise<TestConnectionResult> {
  const { auth_token, manager_token } = credentials;

  if (!auth_token?.trim() || !manager_token?.trim()) {
    return { ok: false, error: 'Both Authorization Token and Manager Token are required.' };
  }

  let response: Response;
  try {
    response = await fetch(`${ZID_API_BASE}/managers/store/orders?page=1&per_page=1`, {
      method: 'GET',
      headers: {
        Authorization: auth_token.trim(),
        'X-Manager-Token': manager_token.trim(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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
    401: 'Unauthorized — check your Authorization Token.',
    403: 'Forbidden — check your Manager Token or store permissions.',
    404: 'Store not found — verify your Manager Token is for an active store.',
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
 * Throws if the payload is missing required fields.
 */
export function parseZidCredentials(decrypted: string): ZidCredentials {
  const parsed = JSON.parse(decrypted) as Record<string, unknown>;
  if (typeof parsed.auth_token !== 'string' || typeof parsed.manager_token !== 'string') {
    throw new Error('Invalid Zid credentials payload — missing auth_token or manager_token.');
  }
  return {
    auth_token: parsed.auth_token,
    manager_token: parsed.manager_token,
  };
}
