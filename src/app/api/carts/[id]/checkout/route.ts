import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { engineSendText } from '@/lib/flows/meta-send';
import { supabaseAdmin } from '@/lib/flows/admin-client';

function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

/**
 * POST /api/carts/[id]/checkout
 *
 * Sends a payment instruction message to the customer via WhatsApp,
 * then marks the cart as 'checkout_sent'.
 *
 * The message body is the account's `payment_instructions` template
 * (editable in Settings → Catalog), prefixed with a cart summary.
 * The caller may override the payment note for this specific checkout.
 *
 * Body: { conversation_id, payment_note? }
 *
 * Agent+ required.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: cartId } = await context.params;
    const { supabase, accountId, userId } = await getCurrentAccount();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return bad('Invalid JSON body');
    }

    const conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : null;
    if (!conversationId) return bad("'conversation_id' is required");

    // Load cart with items.
    const { data: cart, error: cartErr } = await supabase
      .from('whatsapp_carts')
      .select(`
        id, status, account_id, contact_id, conversation_id,
        items:whatsapp_cart_items(
          id, product_name, product_price, variant_label, quantity
        )
      `)
      .eq('id', cartId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (cartErr || !cart) return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
    if (cart.status !== 'open') {
      return NextResponse.json({ error: 'Cart is no longer open' }, { status: 409 });
    }

    const items = (cart.items ?? []) as Array<{
      product_name: string;
      product_price: number;
      variant_label: string | null;
      quantity: number;
    }>;

    if (items.length === 0) {
      return bad('Cart is empty — add items before checking out');
    }

    // Load account payment instructions (and contact for context).
    const db = supabaseAdmin();
    const { data: accountRow } = await db
      .from('accounts')
      .select('payment_instructions, default_currency')
      .eq('id', accountId)
      .maybeSingle();

    const paymentNote =
      typeof body.payment_note === 'string'
        ? body.payment_note.trim()
        : (accountRow?.payment_instructions?.trim() ?? '');

    // Build the cart summary.
    const currency = accountRow?.default_currency ?? 'SAR';
    const lines = items
      .map((item) => {
        const variant = item.variant_label ? ` (${item.variant_label})` : '';
        const subtotal = (item.product_price * item.quantity).toFixed(2);
        return `• ${item.product_name}${variant} × ${item.quantity} — ${currency} ${subtotal}`;
      })
      .join('\n');

    const total = items
      .reduce((sum, item) => sum + item.product_price * item.quantity, 0)
      .toFixed(2);

    const message = [
      '🛒 *Your order summary:*',
      lines,
      `\n*Total: ${currency} ${total}*`,
      paymentNote ? `\n💳 *Payment:*\n${paymentNote}` : '',
      '\nThank you for your order! We\'ll confirm once payment is received. 🙏',
    ]
      .filter(Boolean)
      .join('\n');

    // Send via WhatsApp.
    await engineSendText({
      accountId,
      userId,
      conversationId,
      contactId: cart.contact_id,
      text: message,
    });

    // Mark cart as checkout_sent.
    const { error: updateErr } = await supabase
      .from('whatsapp_carts')
      .update({
        status: 'checkout_sent',
        checkout_note: paymentNote || null,
        conversation_id: conversationId,
      })
      .eq('id', cartId);

    if (updateErr) {
      console.error('[cart checkout] status update error:', updateErr);
      // Message was sent — don't return 500, just log.
    }

    return NextResponse.json({
      ok: true,
      message_sent: message,
      cart_id: cartId,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
