import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

/**
 * GET /api/catalog
 *
 * Returns all active products for the account, ordered by sort_order.
 * Any account member can read (agents need to browse while on a call).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('catalog_products')
      .select('id, name, description, price, currency, image_url, variants, tags, is_active, sort_order, created_at, updated_at')
      .eq('account_id', accountId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[catalog GET] fetch error:', error);
      return NextResponse.json({ error: 'Failed to load catalog' }, { status: 500 });
    }

    return NextResponse.json({ products: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/catalog
 *
 * Create a new product. Admin+ only.
 *
 * Body: { name, description?, price, currency?, image_url?, variants?, tags?, is_active?, sort_order? }
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const rl = checkRateLimit(userId, RATE_LIMITS.adminAction);
    if (!rl.success) return rateLimitResponse(rl);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return bad('Invalid JSON body');
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return bad("'name' is required");

    const price = typeof body.price === 'number' ? body.price : parseFloat(String(body.price ?? '0'));
    if (!Number.isFinite(price) || price < 0) return bad("'price' must be a non-negative number");

    // Fetch account's default currency if not specified in request body
    let currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
    if (!currency) {
      const { data: acct } = await supabase
        .from('accounts')
        .select('default_currency')
        .eq('id', accountId)
        .maybeSingle();
      currency = acct?.default_currency || 'SAR';
    }

    const { data: product, error } = await supabase
      .from('catalog_products')
      .insert({
        account_id: accountId,
        created_by: userId,
        name,
        description: typeof body.description === 'string' ? body.description.trim() || null : null,
        price,
        currency,
        image_url: typeof body.image_url === 'string' ? body.image_url.trim() || null : null,
        variants: Array.isArray(body.variants) ? body.variants : [],
        tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : [],
        is_active: body.is_active !== false,
        sort_order: typeof body.sort_order === 'number' ? Math.round(body.sort_order) : 0,
      })
      .select('id, name, description, price, currency, image_url, variants, tags, is_active, sort_order, created_at, updated_at')
      .single();

    if (error || !product) {
      console.error('[catalog POST] insert error:', error);
      return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
    }

    return NextResponse.json({ product }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
