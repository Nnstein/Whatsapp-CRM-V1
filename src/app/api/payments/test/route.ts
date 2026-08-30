import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { getPaymentConnectorMeta, PAYMENT_CONNECTOR_IDS } from '@/lib/payments/registry';
import { testMyFatoorahConnection } from '@/lib/payments/myfatoorah/client';
import { decrypt } from '@/lib/whatsapp/encryption';
import type { TestPaymentResult } from '@/lib/payments/types';

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * POST /api/payments/test
 *
 * Run a live connection test for a payment connector WITHOUT persisting
 * credentials. Credentials are accepted in the request body
 * (never from DB) so the user can test before saving.
 *
 * On success, updates `last_tested_at` / `last_test_status` / `gateway_label`
 * on any existing row for this connector type.
 *
 * Admin+ only.
 *
 * Body: { connector_type, credentials?, use_saved?: boolean }
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');

    const limit = checkRateLimit(`payments:test:${accountId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad('Invalid request body');

    const { connector_type, credentials, use_saved } = body as {
      connector_type?: unknown;
      credentials?: unknown;
      use_saved?: boolean;
    };

    if (typeof connector_type !== 'string' || !PAYMENT_CONNECTOR_IDS.includes(connector_type)) {
      return bad(`Unknown connector type. Supported: ${PAYMENT_CONNECTOR_IDS.join(', ')}`);
    }

    let creds: Record<string, unknown>;

    if (use_saved) {
      const { data, error } = await supabase
        .from('payment_connections')
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

      const meta = getPaymentConnectorMeta(connector_type)!;
      for (const field of meta.fields) {
        if (field.required && !creds[field.key]?.toString()?.trim()) {
          return bad(`Missing required field: ${field.label}`);
        }
      }
    }

    // Dispatch to gateway-specific test function.
    let result: TestPaymentResult;

    if (connector_type === 'myfatoorah') {
      result = await testMyFatoorahConnection({
        api_key: String(creds.api_key ?? '').trim(),
        environment: String(creds.environment ?? 'test').trim(),
        country_iso: String(creds.country_iso ?? '').trim(),
      });
    } else {
      return bad(`Test not implemented for connector: ${connector_type}`);
    }

    // Fire-and-forget: update test metadata on any existing saved row.
    supabase
      .from('payment_connections')
      .update({
        last_tested_at: new Date().toISOString(),
        last_test_status: result.ok ? 'ok' : 'error',
        last_test_error: result.ok ? null : (result.error ?? null),
        gateway_label: result.ok ? (result.gatewayName ?? null) : null,
      })
      .eq('account_id', accountId)
      .eq('connector_type', connector_type)
      .then(({ error }) => {
        if (error) console.warn('[payments/test] metadata update failed:', error);
      });

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
