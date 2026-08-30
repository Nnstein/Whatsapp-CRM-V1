import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { encrypt } from '@/lib/whatsapp/encryption';
import { getPaymentConnectorMeta, PAYMENT_CONNECTOR_IDS } from '@/lib/payments/registry';

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * GET /api/payments
 *
 * Returns all payment connections for the caller's account.
 * Credentials are NEVER returned — only `has_credentials: true`.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('payment_connections')
      .select(
        'id, connector_type, gateway_label, is_active, last_tested_at, last_test_status, last_test_error, webhook_secret, created_at, updated_at',
      )
      .eq('account_id', accountId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[payments GET] fetch error:', error);
      return NextResponse.json({ error: 'Failed to load payment connections' }, { status: 500 });
    }

    return NextResponse.json({
      connections: (data ?? []).map((row) => ({
        ...row,
        has_credentials: true,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/payments
 *
 * Upsert a payment connection for the caller's account.
 * Admin+ only.
 *
 * Body: { connector_type: string, credentials: Record<string, string> }
 *
 * Credentials are validated then AES-256-GCM encrypted before storage.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(`payments:save:${accountId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad('Invalid request body');

    const { connector_type, credentials } = body as {
      connector_type?: unknown;
      credentials?: unknown;
    };

    if (typeof connector_type !== 'string' || !PAYMENT_CONNECTOR_IDS.includes(connector_type)) {
      return bad(`Unknown connector type. Supported: ${PAYMENT_CONNECTOR_IDS.join(', ')}`);
    }

    const meta = getPaymentConnectorMeta(connector_type)!;

    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
      return bad('credentials must be an object');
    }

    const creds = credentials as Record<string, unknown>;

    for (const field of meta.fields) {
      if (field.required && !creds[field.key]?.toString()?.trim()) {
        return bad(`Missing required field: ${field.label}`);
      }
    }

    const sanitized: Record<string, string> = {};
    for (const field of meta.fields) {
      if (creds[field.key] !== undefined) {
        sanitized[field.key] = String(creds[field.key]).trim();
      }
    }

    const credentialsEncrypted = encrypt(JSON.stringify(sanitized));

    const { data, error } = await supabase
      .from('payment_connections')
      .upsert(
        {
          account_id: accountId,
          created_by: userId,
          connector_type,
          credentials_encrypted: credentialsEncrypted,
          is_active: true,
          last_tested_at: null,
          last_test_status: null,
          last_test_error: null,
          gateway_label: null,
        },
        { onConflict: 'account_id,connector_type' },
      )
      .select(
        'id, connector_type, gateway_label, is_active, last_tested_at, last_test_status, last_test_error, webhook_secret, created_at, updated_at',
      )
      .single();

    if (error) {
      console.error('[payments POST] upsert error:', error);
      return NextResponse.json({ error: 'Failed to save payment connection' }, { status: 500 });
    }

    // Backfill webhook_secret on first save.
    let finalData = data;
    if (!data.webhook_secret) {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const { data: updated } = await supabase
        .from('payment_connections')
        .update({ webhook_secret: token })
        .eq('id', data.id)
        .select(
          'id, connector_type, gateway_label, is_active, last_tested_at, last_test_status, last_test_error, webhook_secret, created_at, updated_at',
        )
        .single();
      if (updated) finalData = updated;
    }

    return NextResponse.json({ connection: { ...finalData, has_credentials: true } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/payments
 *
 * Remove a payment connection. Admin+ only.
 * Body: { connector_type: string }
 */
export async function DELETE(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');

    const body = await request.json().catch(() => null);
    const { connector_type } = (body ?? {}) as { connector_type?: unknown };

    if (typeof connector_type !== 'string') return bad('connector_type is required');

    const { error } = await supabase
      .from('payment_connections')
      .delete()
      .eq('account_id', accountId)
      .eq('connector_type', connector_type);

    if (error) {
      console.error('[payments DELETE] error:', error);
      return NextResponse.json({ error: 'Failed to remove payment connection' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
