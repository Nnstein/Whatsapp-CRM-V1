import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { getConnectorMeta, CONNECTOR_IDS } from '@/lib/stores/registry';
import { testZidConnection } from '@/lib/stores/zid/client';
import { decrypt } from '@/lib/whatsapp/encryption';
import type { TestConnectionResult } from '@/lib/stores/types';

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * POST /api/stores/test
 *
 * Run a live connection test for a connector WITHOUT persisting
 * credentials. Credentials are accepted in the request body
 * (never from the DB) so the user can test before saving.
 *
 * On success, updates `last_tested_at` / `last_test_status` /
 * `store_label` on any existing row for this connector type.
 * This is a write to the *test metadata* only — credentials are
 * not re-encrypted or updated here.
 *
 * Admin+ only.
 *
 * Body:
 *   { connector_type: string, credentials: Record<string, string>, use_saved?: boolean }
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');

    const limit = checkRateLimit(`stores:test:${accountId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad('Invalid request body');

    const { connector_type, credentials, use_saved } = body as {
      connector_type?: unknown;
      credentials?: unknown;
      use_saved?: boolean;
    };

    if (typeof connector_type !== 'string' || !CONNECTOR_IDS.includes(connector_type)) {
      return bad(`Unknown connector type. Supported: ${CONNECTOR_IDS.join(', ')}`);
    }

    let creds: Record<string, unknown>;

    if (use_saved) {
      const { data, error } = await supabase
        .from('store_connections')
        .select('credentials_encrypted')
        .eq('account_id', accountId)
        .eq('connector_type', connector_type)
        .single();
      
      if (error || !data) return bad('No saved credentials found');
      creds = JSON.parse(decrypt(data.credentials_encrypted));
    } else {
      if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
        return bad('credentials must be an object');
      }
      creds = credentials as Record<string, unknown>;
      
      const meta = getConnectorMeta(connector_type)!;
      // Validate required fields.
      for (const field of meta.fields) {
        if (field.required && !creds[field.key]?.toString()?.trim()) {
          return bad(`Missing required field: ${field.label}`);
        }
      }
    }

    // Dispatch to the connector-specific test function.
    let result: TestConnectionResult;

    if (connector_type === 'zid') {
      result = await testZidConnection({
        auth_token: String(creds.auth_token ?? '').trim(),
        manager_token: String(creds.manager_token ?? '').trim(),
      });
    } else {
      // Future connectors: add their test dispatch here.
      return bad(`Test not implemented for connector: ${connector_type}`);
    }

    // Fire-and-forget: update test metadata on any existing saved row.
    // We intentionally do NOT await this — the test result is returned
    // immediately to the UI; the DB update is best-effort.
    supabase
      .from('store_connections')
      .update({
        last_tested_at: new Date().toISOString(),
        last_test_status: result.ok ? 'ok' : 'error',
        last_test_error: result.ok ? null : (result.error ?? null),
        store_label: result.ok ? (result.storeName ?? null) : null,
      })
      .eq('account_id', accountId)
      .eq('connector_type', connector_type)
      .then(({ error }) => {
        if (error) console.warn('[stores/test] metadata update failed:', error);
      });

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
