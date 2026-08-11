import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

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
