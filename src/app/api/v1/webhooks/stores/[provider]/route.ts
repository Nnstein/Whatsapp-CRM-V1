import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getStoreAdapter } from '@/lib/stores/adapters/registry';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

/**
 * POST /api/v1/webhooks/stores/[provider]
 *
 * Public store order webhook receiver (Zid, Salla, Generic/Custom Store).
 *
 * Body: Raw JSON payload sent by the e-commerce store / snippet.
 * Optional query: `?token=ACCOUNT_ID_OR_TOKEN`
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return bad('Invalid JSON body');
    }

    // 1. Parse order payload via adapter
    const parsed = adapter.parseOrderWebhook(request.headers, body);
    if (!parsed || !parsed.customerPhone || !parsed.externalOrderId) {
      return NextResponse.json({
        received: true,
        processed: false,
        reason: 'Payload missing required fields (customerPhone or externalOrderId)',
      });
    }

    const db = supabaseAdmin();
    const normalizedDigits = normalizePhone(parsed.customerPhone);
    const suffix = normalizedDigits.slice(-8);

    // 2. Find matching contact by phone suffix
    const { data: contacts } = await db
      .from('contacts')
      .select('id, account_id, name, phone')
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

    // 3. Look for active or checkout_sent cart for this contact
    const { data: carts } = await db
      .from('whatsapp_carts')
      .select('id, status')
      .eq('account_id', contact.account_id)
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
      } else if (parsed.status === 'cancelled') {
        await db
          .from('whatsapp_carts')
          .update({ status: 'cancelled' })
          .eq('id', activeCart.id);
      }
    }

    // 4. Log contact note / timeline entry for the order
    const noteText = `🛒 Store Order #${parsed.externalOrderId} (${provider.toUpperCase()}):\nTotal: ${parsed.currency} ${parsed.totalAmount.toFixed(2)} — Status: ${parsed.status.toUpperCase()}`;

    try {
      await db.from('contact_notes').insert({
        account_id: contact.account_id,
        contact_id: contact.id,
        note_text: noteText,
      });
    } catch {
      // Best effort note logging
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
