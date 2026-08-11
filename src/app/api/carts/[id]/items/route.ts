import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

/**
 * POST /api/carts/[id]/items
 *
 * Add or update an item in the cart.
 * - If the same product_id (+ variant_label) already exists, increments quantity.
 * - Otherwise inserts a new line item.
 * Snapshots product name and price from catalog_products at insert time.
 *
 * Body: { product_id, quantity?, variant_label? }
 *
 * Agent+ required.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: cartId } = await context.params;
    const { supabase, accountId } = await getCurrentAccount();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return bad('Invalid JSON body');
    }

    const productId = typeof body.product_id === 'string' ? body.product_id : null;
    if (!productId) return bad("'product_id' is required");

    const quantity =
      typeof body.quantity === 'number' && Number.isInteger(body.quantity) && body.quantity > 0
        ? body.quantity
        : 1;

    const variantLabel = typeof body.variant_label === 'string' ? body.variant_label.trim() || null : null;

    // Gate: cart must be open and belong to this account.
    const { data: cart } = await supabase
      .from('whatsapp_carts')
      .select('id, status, account_id')
      .eq('id', cartId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (!cart) return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
    if (cart.status !== 'open') {
      return NextResponse.json({ error: 'Cart is no longer open' }, { status: 409 });
    }

    // Load the product to snapshot name + price.
    const { data: product } = await supabase
      .from('catalog_products')
      .select('id, name, price, is_active')
      .eq('id', productId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    if (!product.is_active) {
      return NextResponse.json({ error: 'Product is no longer available' }, { status: 400 });
    }

    // Check if this product+variant already exists in the cart — merge qty.
    const { data: existing } = await supabase
      .from('whatsapp_cart_items')
      .select('id, quantity')
      .eq('cart_id', cartId)
      .eq('product_id', productId)
      .eq('variant_label', variantLabel ?? '')
      .maybeSingle();

    let item: Record<string, unknown>;
    if (existing) {
      const { data: updated, error } = await supabase
        .from('whatsapp_cart_items')
        .update({ quantity: existing.quantity + quantity })
        .eq('id', existing.id)
        .select('id, product_id, product_name, product_price, variant_label, quantity, created_at')
        .single();
      if (error || !updated) {
        console.error('[cart items POST] update error:', error);
        return NextResponse.json({ error: 'Failed to update item' }, { status: 500 });
      }
      item = updated;
    } else {
      const { data: created, error } = await supabase
        .from('whatsapp_cart_items')
        .insert({
          cart_id: cartId,
          product_id: productId,
          product_name: product.name,
          product_price: product.price,
          variant_label: variantLabel,
          quantity,
        })
        .select('id, product_id, product_name, product_price, variant_label, quantity, created_at')
        .single();
      if (error || !created) {
        console.error('[cart items POST] insert error:', error);
        return NextResponse.json({ error: 'Failed to add item' }, { status: 500 });
      }
      item = created;
    }

    return NextResponse.json({ item }, existing ? { status: 200 } : { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
