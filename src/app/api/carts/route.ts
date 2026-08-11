import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

/**
 * GET /api/carts?contact_id=…
 *
 * Returns the open cart (with items) for a given contact.
 * Returns 404 if no open cart exists.
 * Any account member can read.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get('contact_id');
    if (!contactId) return bad("'contact_id' query param is required");

    const { data: cart, error } = await supabase
      .from('whatsapp_carts')
      .select(`
        id, status, checkout_note, store_order_id, confirmed_at, created_at, updated_at,
        conversation_id,
        contact:contacts(id, name, phone),
        items:whatsapp_cart_items(
          id, product_id, product_name, product_price, variant_label, quantity, created_at
        )
      `)
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .maybeSingle();

    if (error) {
      console.error('[carts GET] fetch error:', error);
      return NextResponse.json({ error: 'Failed to load cart' }, { status: 500 });
    }
    if (!cart) {
      return NextResponse.json({ error: 'No open cart' }, { status: 404 });
    }

    return NextResponse.json({ cart });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/carts
 *
 * Get or create the open cart for a contact.
 * Returns the existing open cart if one exists, otherwise creates one.
 * Agent+ required (the cart-intent bot creates carts).
 *
 * Body: { contact_id, conversation_id? }
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return bad('Invalid JSON body');
    }

    const contactId = typeof body.contact_id === 'string' ? body.contact_id : null;
    if (!contactId) return bad("'contact_id' is required");

    const conversationId =
      typeof body.conversation_id === 'string' ? body.conversation_id : null;

    // Check for existing open cart.
    const { data: existing } = await supabase
      .from('whatsapp_carts')
      .select(`
        id, status, checkout_note, store_order_id, confirmed_at, created_at, updated_at,
        conversation_id,
        contact:contacts(id, name, phone),
        items:whatsapp_cart_items(
          id, product_id, product_name, product_price, variant_label, quantity, created_at
        )
      `)
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .maybeSingle();

    if (existing) {
      // Update conversation_id if provided and different.
      if (conversationId && existing.conversation_id !== conversationId) {
        await supabase
          .from('whatsapp_carts')
          .update({ conversation_id: conversationId })
          .eq('id', existing.id);
      }
      return NextResponse.json({ cart: existing, created: false });
    }

    // Create a new open cart.
    const { data: cart, error } = await supabase
      .from('whatsapp_carts')
      .insert({
        account_id: accountId,
        contact_id: contactId,
        conversation_id: conversationId,
        status: 'open',
      })
      .select(`
        id, status, checkout_note, store_order_id, confirmed_at, created_at, updated_at,
        conversation_id,
        contact:contacts(id, name, phone),
        items:whatsapp_cart_items(
          id, product_id, product_name, product_price, variant_label, quantity, created_at
        )
      `)
      .single();

    if (error || !cart) {
      console.error('[carts POST] insert error:', error);
      return NextResponse.json({ error: 'Failed to create cart' }, { status: 500 });
    }

    return NextResponse.json({ cart, created: true }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
