import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

/**
 * PUT /api/carts/[id]/items/[itemId]
 *
 * Update a line item in place — set an absolute quantity and/or change the
 * variant. Unlike POST /items (which increments), this replaces values.
 *
 * Body: { quantity?, variant_label? }  — at least one required.
 * Setting quantity to 0 removes the item (same as DELETE).
 *
 * Agent+ required.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: cartId, itemId } = await context.params;
    const { supabase, accountId } = await getCurrentAccount();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return bad('Invalid JSON body');
    }

    const hasQuantity = body.quantity !== undefined;
    const hasVariant = body.variant_label !== undefined;
    if (!hasQuantity && !hasVariant) {
      return bad("Provide 'quantity' and/or 'variant_label'");
    }

    let quantity: number | null = null;
    if (hasQuantity) {
      if (
        typeof body.quantity !== 'number' ||
        !Number.isInteger(body.quantity) ||
        body.quantity < 0
      ) {
        return bad("'quantity' must be a non-negative integer");
      }
      quantity = body.quantity;
    }

    // Verify the cart belongs to this account and is still open.
    const { data: cart } = await supabase
      .from('whatsapp_carts')
      .select('id, status')
      .eq('id', cartId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (!cart) return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
    if (cart.status !== 'open') {
      return NextResponse.json({ error: 'Cart is no longer open' }, { status: 409 });
    }

    // Quantity 0 = remove the line item entirely.
    if (quantity === 0) {
      const { error } = await supabase
        .from('whatsapp_cart_items')
        .delete()
        .eq('id', itemId)
        .eq('cart_id', cartId);
      if (error) {
        console.error('[cart items PUT] delete-on-zero error:', error);
        return NextResponse.json({ error: 'Failed to remove item' }, { status: 500 });
      }
      return NextResponse.json({ ok: true, removed: true });
    }

    const updates: Record<string, unknown> = {};
    if (quantity !== null) updates.quantity = quantity;
    if (hasVariant) {
      updates.variant_label =
        typeof body.variant_label === 'string' ? body.variant_label.trim() || null : null;
    }

    const { data: item, error } = await supabase
      .from('whatsapp_cart_items')
      .update(updates)
      .eq('id', itemId)
      .eq('cart_id', cartId)
      .select('id, product_id, product_name, product_price, variant_label, quantity, created_at')
      .maybeSingle();

    if (error) {
      console.error('[cart items PUT] update error:', error);
      return NextResponse.json({ error: 'Failed to update item' }, { status: 500 });
    }
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

    return NextResponse.json({ item });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/carts/[id]/items/[itemId]
 *
 * Remove a line item from the cart.
 * Agent+ required.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: cartId, itemId } = await context.params;
    const { supabase, accountId } = await getCurrentAccount();

    // Verify the cart belongs to this account.
    const { data: cart } = await supabase
      .from('whatsapp_carts')
      .select('id, status')
      .eq('id', cartId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (!cart) return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
    if (cart.status !== 'open') {
      return NextResponse.json({ error: 'Cart is no longer open' }, { status: 409 });
    }

    const { error } = await supabase
      .from('whatsapp_cart_items')
      .delete()
      .eq('id', itemId)
      .eq('cart_id', cartId);

    if (error) {
      console.error('[cart items DELETE] error:', error);
      return NextResponse.json({ error: 'Failed to remove item' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
