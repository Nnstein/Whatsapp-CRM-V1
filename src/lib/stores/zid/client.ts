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
 * Zid requires TWO DIFFERENT tokens on every Merchant API request
 * (https://docs.zid.sa/authorization — "These headers represent
 * different values and must not be treated as interchangeable"):
 *
 *   Authorization: Bearer <authorization_token>
 *     App-level JWT from the OAuth flow (install a private app from
 *     the Zid Partner Dashboard on the store).
 *
 *   X-Manager-Token: <access_token>
 *     Per-store Manager Token. Zid's docs call this the "access
 *     token" — the merchant can generate it in their dashboard under
 *     Settings → API Integrations → Generate Manager Token.
 *
 * Sending one token as both headers (the old behaviour) always fails
 * with 401. Both tokens are stored AES-256-GCM-encrypted in
 * `store_connections.credentials_encrypted` and decrypted server-side
 * immediately before each call; they are never sent to the client.
 */

import type { TestConnectionResult } from '../types';

const ZID_API_BASE = 'https://api.zid.sa/v1';

export interface ZidCredentials {
  store_id?: string;
  /** App-level JWT → Authorization: Bearer header. */
  authorization_token?: string;
  /** Per-store Manager Token → X-Manager-Token header. */
  access_token?: string;
  /** Legacy alias of authorization_token. */
  auth_token?: string;
  /** Legacy alias of access_token. */
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
  const managerToken = (credentials.access_token || credentials.manager_token || '').trim();
  const authToken = (credentials.authorization_token || credentials.auth_token || '').trim();
  const storeId = (credentials.store_id || '').trim();

  if (!managerToken && !authToken) {
    return { ok: false, error: 'Manager Token and Authorization Token are both required.' };
  }
  if (!managerToken) {
    return {
      ok: false,
      error: 'Manager Token is required — Zid merchant dashboard → Settings → API Integrations → Generate Manager Token.',
    };
  }
  if (!authToken) {
    return {
      ok: false,
      error:
        'Authorization Token is required — Zid needs BOTH an Authorization Token (JWT from the OAuth app flow) and a Manager Token. They are different values; the Manager Token alone cannot authenticate.',
    };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken.replace(/^bearer\s+/i, '')}`,
    'X-Manager-Token': managerToken,
    Role: 'Manager',
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
    401: 'Unauthorized — check BOTH tokens: the Authorization Token (JWT) and the Manager Token must be valid, and the app must be installed on this store.',
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
 * Keeps the two Zid tokens DISTINCT (authorization_token = Bearer JWT,
 * access_token = X-Manager-Token); legacy single-token payloads parse
 * fine but will fail the connection test with a clear "both tokens
 * required" error until the merchant re-saves with both.
 */
export function parseZidCredentials(decrypted: string): ZidCredentials {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(decrypted) as Record<string, unknown>;
  } catch {
    // fallback if unparsed
  }

  const managerToken = String(
    parsed.access_token || parsed.accessToken || parsed.manager_token || ''
  ).trim();
  const authToken = String(
    parsed.authorization_token || parsed.authorizationToken || parsed.auth_token || ''
  ).trim();
  const storeId = String(parsed.store_id || parsed.storeId || '').trim();

  if (!managerToken) {
    throw new Error('Invalid Zid credentials payload — missing access_token (Manager Token).');
  }

  return {
    store_id: storeId || undefined,
    authorization_token: authToken || undefined,
    access_token: managerToken,
    auth_token: authToken || undefined,
    manager_token: managerToken,
  };
}
