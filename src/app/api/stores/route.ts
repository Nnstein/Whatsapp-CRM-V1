import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { getConnectorMeta, CONNECTOR_IDS } from '@/lib/stores/registry';

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * GET /api/stores
 *
 * Returns all store connections for the caller's account.
 * Credentials are NEVER returned — only `has_credentials: true`.
 * Viewer+ may read (they need to know if a store is connected).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('store_connections')
      .select(
        'id, connector_type, store_label, is_active, last_tested_at, last_test_status, last_test_error, created_at, updated_at',
      )
      .eq('account_id', accountId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[stores GET] fetch error:', error);
      return NextResponse.json({ error: 'Failed to load store connections' }, { status: 500 });
    }

    return NextResponse.json({
      connections: (data ?? []).map((row) => ({
        ...row,
        has_credentials: true, // credentials_encrypted always present if row exists
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/stores
 *
 * Upsert a store connection for the caller's account.
 * Admin+ only.
 *
 * Body:
 *   { connector_type: string, credentials: Record<string, string> }
 *
 * Credentials are validated against the connector's field definitions,
 * then AES-256-GCM encrypted before storage. The raw values are never
 * persisted in plaintext.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(`stores:save:${accountId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad('Invalid request body');

    const { connector_type, credentials } = body as {
      connector_type?: unknown;
      credentials?: unknown;
    };

    // Validate connector type.
    if (typeof connector_type !== 'string' || !CONNECTOR_IDS.includes(connector_type)) {
      return bad(`Unknown connector type. Supported: ${CONNECTOR_IDS.join(', ')}`);
    }

    const meta = getConnectorMeta(connector_type)!;

    // Validate credentials object shape.
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
      return bad('credentials must be an object');
    }

    const creds = credentials as Record<string, unknown>;

    for (const field of meta.fields) {
      if (field.required && !creds[field.key]?.toString()?.trim()) {
        return bad(`Missing required field: ${field.label}`);
      }
    }

    // Sanitize — only keep the keys declared in the field definitions.
    const sanitized: Record<string, string> = {};
    for (const field of meta.fields) {
      if (creds[field.key] !== undefined) {
        sanitized[field.key] = String(creds[field.key]).trim();
      }
    }

    const credentialsEncrypted = encrypt(JSON.stringify(sanitized));

    const { data, error } = await supabase
      .from('store_connections')
      .upsert(
        {
          account_id: accountId,
          created_by: userId,
          connector_type,
          credentials_encrypted: credentialsEncrypted,
          is_active: true,
          // Clear stale test state on credential update.
          last_tested_at: null,
          last_test_status: null,
          last_test_error: null,
          store_label: null,
        },
        { onConflict: 'account_id,connector_type' },
      )
      .select(
        'id, connector_type, store_label, is_active, last_tested_at, last_test_status, last_test_error, created_at, updated_at',
      )
      .single();

    if (error) {
      console.error('[stores POST] upsert error:', error);
      return NextResponse.json({ error: 'Failed to save store connection' }, { status: 500 });
    }

    return NextResponse.json({ connection: { ...data, has_credentials: true } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/stores
 *
 * Remove a store connection. Admin+ only.
 * Body: { connector_type: string }
 */
export async function DELETE(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');

    const body = await request.json().catch(() => null);
    const { connector_type } = (body ?? {}) as { connector_type?: unknown };

    if (typeof connector_type !== 'string') return bad('connector_type is required');

    const { error } = await supabase
      .from('store_connections')
      .delete()
      .eq('account_id', accountId)
      .eq('connector_type', connector_type);

    if (error) {
      console.error('[stores DELETE] error:', error);
      return NextResponse.json({ error: 'Failed to remove store connection' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
