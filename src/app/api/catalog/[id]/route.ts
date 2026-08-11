import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

/**
 * PUT /api/catalog/[id]
 *
 * Update a product. Admin+ only.
 * Partial updates: only fields present in the body are changed.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { supabase, accountId, userId } = await requireRole('admin');

    const rl = checkRateLimit(userId, RATE_LIMITS.adminAction);
    if (!rl.success) return rateLimitResponse(rl);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return bad('Invalid JSON body');
    }

    // Build the update payload from whichever fields were provided.
    const updates: Record<string, unknown> = {};
    if (typeof body.name === 'string') {
      const n = body.name.trim();
      if (!n) return bad("'name' cannot be empty");
      updates.name = n;
    }
    if ('description' in body) {
      updates.description = typeof body.description === 'string' ? body.description.trim() || null : null;
    }
    if ('price' in body) {
      const p = typeof body.price === 'number' ? body.price : parseFloat(String(body.price));
      if (!Number.isFinite(p) || p < 0) return bad("'price' must be a non-negative number");
      updates.price = p;
    }
    if (typeof body.currency === 'string') updates.currency = body.currency.trim().toUpperCase();
    if ('image_url' in body) {
      updates.image_url = typeof body.image_url === 'string' ? body.image_url.trim() || null : null;
    }
    if (Array.isArray(body.variants)) updates.variants = body.variants;
    if (Array.isArray(body.tags)) {
      updates.tags = body.tags.filter((t): t is string => typeof t === 'string');
    }
    if (typeof body.is_active === 'boolean') updates.is_active = body.is_active;
    if (typeof body.sort_order === 'number') updates.sort_order = Math.round(body.sort_order);

    if (Object.keys(updates).length === 0) return bad('No updatable fields provided');

    const { data: product, error } = await supabase
      .from('catalog_products')
      .update(updates)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, name, description, price, currency, image_url, variants, tags, is_active, sort_order, updated_at')
      .single();

    if (error) {
      console.error('[catalog PUT] update error:', error);
      return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
    }
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json({ product });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/catalog/[id]
 *
 * Soft-deletes a product by setting is_active = false.
 * Admin+ only. Does not remove existing cart item snapshots.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { supabase, accountId, userId } = await requireRole('admin');

    const rl = checkRateLimit(userId, RATE_LIMITS.adminAction);
    if (!rl.success) return rateLimitResponse(rl);

    const { error } = await supabase
      .from('catalog_products')
      .update({ is_active: false })
      .eq('id', id)
      .eq('account_id', accountId);

    if (error) {
      console.error('[catalog DELETE] error:', error);
      return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
