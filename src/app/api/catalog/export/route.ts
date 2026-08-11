import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { exportCatalogCsv, ParsedCsvProduct } from '@/lib/catalog/csv';

/**
 * GET /api/catalog/export
 *
 * Export all catalog products for the account in Zid-compatible CSV format.
 * Accessible by any account member.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data: rawProducts, error } = await supabase
      .from('catalog_products')
      .select('*')
      .eq('account_id', accountId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[catalog/export] fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch catalog products' }, { status: 500 });
    }

    const parsedProducts: ParsedCsvProduct[] = (rawProducts || []).map((p: any) => ({
      sku: p.sku || null,
      name: p.name,
      description: p.description || null,
      price: Number(p.price) || 0,
      sale_price: p.sale_price ? Number(p.sale_price) : null,
      cost: p.cost ? Number(p.cost) : null,
      currency: p.currency || 'SAR',
      quantity: p.quantity || 'Infinite',
      categories: Array.isArray(p.categories) ? p.categories : [],
      image_url: p.image_url || null,
      images: Array.isArray(p.images) ? p.images : [],
      weight: Number(p.weight) || 0,
      weight_unit: p.weight_unit || 'kg',
      has_variants: Boolean(p.has_variants),
      variants: Array.isArray(p.variants) ? p.variants : [],
      tags: Array.isArray(p.tags) ? p.tags : [],
    }));

    const csvContent = exportCatalogCsv(parsedProducts);

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="catalog_export.csv"',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
