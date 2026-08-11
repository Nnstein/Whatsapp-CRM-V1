import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { parseCatalogCsv } from '@/lib/catalog/csv';

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * POST /api/catalog/import
 *
 * Bulk import products from a CSV file (Zid CSV structure compatible).
 * Admin+ only.
 *
 * Body can be either:
 * - JSON: { csv_text: string }
 * - Multipart FormData with file field "file"
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const rl = checkRateLimit(userId, RATE_LIMITS.adminAction);
    if (!rl.success) return rateLimitResponse(rl);

    let csvText = '';

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file || typeof file === 'string') {
        return bad('Missing or invalid CSV file in "file" form parameter');
      }
      csvText = await (file as File).text();
    } else {
      let body: Record<string, unknown>;
      try {
        body = await request.json();
      } catch {
        return bad('Invalid JSON request body');
      }
      if (typeof body.csv_text !== 'string' || !body.csv_text.trim()) {
        return bad("'csv_text' parameter is required");
      }
      csvText = body.csv_text;
    }

    const parsedProducts = parseCatalogCsv(csvText);

    if (parsedProducts.length === 0) {
      return bad('No valid products found in the provided CSV content');
    }

    // Fetch default currency for account
    const { data: acct } = await supabase
      .from('accounts')
      .select('default_currency')
      .eq('id', accountId)
      .maybeSingle();
    const accountCurrency = acct?.default_currency || 'SAR';

    const insertRows = parsedProducts.map((p, idx) => ({
      account_id: accountId,
      created_by: userId,
      sku: p.sku || null,
      name: p.name,
      description: p.description || null,
      price: p.price,
      sale_price: p.sale_price ?? null,
      cost: p.cost ?? null,
      currency: p.currency || accountCurrency,
      quantity: p.quantity || 'Infinite',
      categories: p.categories || [],
      image_url: p.image_url || null,
      images: p.images || [],
      weight: p.weight || 0,
      weight_unit: p.weight_unit || 'kg',
      has_variants: p.has_variants,
      variants: p.variants || [],
      tags: p.tags || [],
      is_active: true,
      sort_order: idx,
    }));

    const { data: inserted, error } = await supabase
      .from('catalog_products')
      .insert(insertRows)
      .select('id, sku, name, price, quantity, variants');

    if (error) {
      console.error('[catalog/import] insert error:', error);
      return NextResponse.json({ error: `Import failed: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      imported_count: inserted?.length ?? 0,
      products: inserted ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
