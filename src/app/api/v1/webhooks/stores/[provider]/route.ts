import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getStoreAdapter } from '@/lib/stores/adapters/registry';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { decrementCartInventory } from '@/lib/stores/inventory';

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

/** Max webhook body size — order payloads are small; anything bigger is junk. */
const MAX_BODY_BYTES = 64 * 1024;

function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Verify X-WACRM-Signature: sha256=<hex hmac of raw body with signing_secret>.
 */
function verifySignature(rawBody: string, secret: string, header: string | null): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const given = header.slice('sha256='.length);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(given, 'utf8'));
}

/**
 * POST /api/v1/webhooks/stores/[provider]?token=<webhook_secret>
 *
 * Public store order webhook receiver (Zid, Salla, Generic/Custom Store).
 *
 * Security model
 * ──────────────
 * Every `store_connections` row has a stable random `webhook_secret` (32 hex
 * chars). The merchant pastes a URL that includes it as `?token=…`. This token
 * scopes the incoming request to a specific account — no account-agnostic phone
 * scanning across all tenants.
 *
 * Lookup order:
 *   1. Validate `?token` is present (400 if missing).
 *   2. Load the store_connections row by (connector_type = provider, webhook_secret = token).
 *      Returns 401 if not found — the token is wrong or the connection was deleted.
 *   3. Resolve the contact within that account only.
 *
 * Body: Raw JSON payload sent by the e-commerce store / snippet.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await context.params;
    const adapter = getStoreAdapter(provider);

    if (!adapter || !adapter.parseOrderWebhook) {
      return bad(`Unsupported store webhook provider '${provider}'`, 404);
    }

    // ── 0. Per-IP rate limit (this endpoint is public) ────────────────────
    const rl = checkRateLimit(`store-webhook:${clientIp(request)}`, {
      limit: 60,
      windowMs: 60_000,
    });
    if (!rl.success) return rateLimitResponse(rl);

    // ── 0b. Body size cap — reject before parsing ─────────────────────────
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      return bad('Payload too large', 413);
    }
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return bad('Payload too large', 413);
    }

    // ── 1. Require the webhook token ──────────────────────────────────────
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!token) {
      return bad(
        'Missing required ?token parameter. Copy the webhook URL from Settings → Store Connectors.',
        400
      );
    }

    const db = supabaseAdmin();

    // ── 2. Resolve account via token (single-row lookup, fully scoped) ────
    const { data: conn } = await db
      .from('store_connections')
      .select('id, account_id, connector_type, signing_secret')
      .eq('connector_type', provider)
      .eq('webhook_secret', token)
      .eq('is_active', true)
      .maybeSingle();

    if (!conn) {
      // Don't leak whether the token exists; use 401.
      return bad('Invalid or unknown webhook token.', 401);
    }

    const accountId = conn.account_id;

    // ── 2b. HMAC signature (only when a signing_secret is configured) ─────
    if (conn.signing_secret) {
      const ok = verifySignature(
        rawBody,
        conn.signing_secret,
        request.headers.get('x-wacrm-signature'),
      );
      if (!ok) {
        return bad('Invalid webhook signature.', 401);
      }
    }

    // ── 3. Parse the order payload ────────────────────────────────────────
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return bad('Invalid JSON body');
    }

    const parsed = adapter.parseOrderWebhook(request.headers, body);
    if (!parsed || !parsed.customerPhone || !parsed.externalOrderId) {
      return NextResponse.json({
        received: true,
        processed: false,
        reason: 'Payload missing required fields (customerPhone or externalOrderId)',
      });
    }

    // ── 4. Resolve contact within THIS account only ───────────────────────
    const normalizedDigits = normalizePhone(parsed.customerPhone);
    const suffix = normalizedDigits.slice(-8);

    const { data: contacts } = await db
      .from('contacts')
      .select('id, account_id, name, phone')
      .eq('account_id', accountId)          // ← scoped to the token's account
      .ilike('phone', `%${suffix}`);

    if (!contacts || contacts.length === 0) {
      return NextResponse.json({
        received: true,
        processed: false,
        reason: `No CRM contact found matching phone ${parsed.customerPhone}`,
      });
    }

    const contact = contacts[0];
    let cartConfirmed = false;

    // ── 5. Update the open/checkout_sent cart if one exists ───────────────
    const { data: carts } = await db
      .from('whatsapp_carts')
      .select('id, status')
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .in('status', ['open', 'checkout_sent'])
      .order('created_at', { ascending: false })
      .limit(1);

    const activeCart = carts && carts.length > 0 ? carts[0] : null;

    if (activeCart) {
      if (parsed.status === 'paid') {
        await db
          .from('whatsapp_carts')
          .update({
            status: 'confirmed',
            store_order_id: parsed.externalOrderId,
            confirmed_at: new Date().toISOString(),
          })
          .eq('id', activeCart.id);
        cartConfirmed = true;

        // Deduct tracked inventory (best-effort — never fail the webhook).
        try {
          await decrementCartInventory(db, activeCart.id);
        } catch (invErr) {
          console.error('[store-webhook] inventory deduction error:', invErr);
        }
      } else if (parsed.status === 'cancelled') {
        await db
          .from('whatsapp_carts')
          .update({ status: 'cancelled' })
          .eq('id', activeCart.id);
      }
    }

    // ── 6. Log a contact note / timeline entry for the order ─────────────
    const noteText =
      `🛒 Store Order #${parsed.externalOrderId} (${provider.toUpperCase()}):\n` +
      `Total: ${parsed.currency} ${parsed.totalAmount.toFixed(2)} — Status: ${parsed.status.toUpperCase()}`;

    try {
      await db.from('contact_notes').insert({
        account_id: accountId,
        contact_id: contact.id,
        note_text: noteText,
      });
    } catch {
      // Best-effort note logging — don't fail the webhook
    }

    return NextResponse.json({
      received: true,
      processed: true,
      cart_confirmed: cartConfirmed,
      order_id: parsed.externalOrderId,
      contact_id: contact.id,
    });
  } catch (err) {
    console.error('[store-webhook] processing error:', err);
    return NextResponse.json({ error: 'Internal webhook processing error' }, { status: 500 });
  }
}
