import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrementCartInventory, type InventoryDeductionResult } from '@/lib/stores/inventory';

/**
 * POST /api/carts/[id]/confirm
 *
 * Admin marks an order as confirmed (payment received, order processing).
 * Transitions status from 'checkout_sent' → 'confirmed'.
 * Admin+ only.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: cartId } = await context.params;
    const { supabase, accountId } = await requireRole('admin');

    const { data: cart } = await supabase
      .from('whatsapp_carts')
      .select('id, status')
      .eq('id', cartId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (!cart) return NextResponse.json({ error: 'Cart not found' }, { status: 404 });

    if (cart.status === 'confirmed') {
      return NextResponse.json({ ok: true, already_confirmed: true });
    }

    if (!['open', 'checkout_sent'].includes(cart.status)) {
      return NextResponse.json(
        { error: `Cannot confirm a cart with status '${cart.status}'` },
        { status: 409 }
      );
    }

    const { error } = await supabase
      .from('whatsapp_carts')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', cartId);

    if (error) {
      console.error('[cart confirm] update error:', error);
      return NextResponse.json({ error: 'Failed to confirm cart' }, { status: 500 });
    }

    // Deduct tracked inventory for the confirmed order (best-effort —
    // never fail the confirm because stock bookkeeping failed).
    let inventory: InventoryDeductionResult | null = null;
    try {
      inventory = await decrementCartInventory(supabase, cartId);
    } catch (invErr) {
      console.error('[cart confirm] inventory deduction error:', invErr);
    }

    return NextResponse.json({ ok: true, inventory });
  } catch (err) {
    return toErrorResponse(err);
  }
}
