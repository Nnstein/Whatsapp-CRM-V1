import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { decrypt } from '@/lib/whatsapp/encryption';
import { syncProductToMetaCatalog, type SyncMetaProductItem } from '@/lib/whatsapp/meta-api';

/**
 * POST /api/catalog/sync/meta
 *
 * Pushes active products in the CRM's catalog to Meta Commerce Manager.
 * Uses the default (or specified) WhatsApp configuration's `meta_catalog_id`
 * and decrypted `access_token`.
 *
 * Admin+ only.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const rl = checkRateLimit(userId, RATE_LIMITS.adminAction);
    if (!rl.success) return rateLimitResponse(rl);

    let body: { config_id?: string } = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional
    }

    // 1. Resolve WhatsApp Config with a meta_catalog_id
    let configQuery = supabase
      .from('whatsapp_config')
      .select('id, access_token, meta_catalog_id, label, is_default')
      .eq('account_id', accountId);

    if (body.config_id) {
      configQuery = configQuery.eq('id', body.config_id);
    } else {
      configQuery = configQuery.order('is_default', { ascending: false });
    }

    const { data: configs, error: configError } = await configQuery;

    if (configError || !configs || configs.length === 0) {
      return NextResponse.json(
        { error: 'No WhatsApp number configuration found for this account.' },
        { status: 400 }
      );
    }

    // Find the first config that has a meta_catalog_id
    const targetConfig = configs.find((c) => !!c.meta_catalog_id) || configs[0];

    if (!targetConfig.meta_catalog_id) {
      return NextResponse.json(
        {
          error:
            'Meta Catalog ID is not configured. Please enter your Meta Commerce Catalog ID in Settings → WhatsApp first.',
        },
        { status: 400 }
      );
    }

    const catalogId = targetConfig.meta_catalog_id;
    let accessToken: string;
    try {
      accessToken = decrypt(targetConfig.access_token);
    } catch (err) {
      return NextResponse.json(
        { error: 'Failed to decrypt WhatsApp access token.' },
        { status: 500 }
      );
    }

    // 2. Fetch all active products for the account
    const { data: products, error: prodError } = await supabase
      .from('catalog_products')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (prodError) {
      console.error('[catalog sync meta] fetch error:', prodError);
      return NextResponse.json({ error: 'Failed to load catalog products.' }, { status: 500 });
    }

    if (!products || products.length === 0) {
      return NextResponse.json({
        success: true,
        synced: 0,
        failed: 0,
        total: 0,
        message: 'No active products found to sync.',
      });
    }

    // 3. Sequentially sync products with a small delay to avoid hitting Meta rate limits
    let synced = 0;
    let failed = 0;
    const errors: string[] = [];
    const now = new Date().toISOString();
    const syncedIds: string[] = [];

    for (const p of products) {
      const item: SyncMetaProductItem = {
        retailer_id: p.id,
        name: p.name,
        description: p.description || p.name,
        price: Number(p.price) || 0,
        currency: p.currency || 'SAR',
        image_url: (Array.isArray(p.images) && p.images[0]) || p.image_url || null,
        availability: p.quantity === '0' ? 'out of stock' : 'in stock',
        condition: 'new',
        category: Array.isArray(p.categories) && p.categories.length > 0 ? p.categories[0] : undefined,
      };

      try {
        await syncProductToMetaCatalog({
          catalogId,
          accessToken,
          product: item,
        });
        synced++;
        syncedIds.push(p.id);
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[catalog sync meta] Failed product "${p.name}" (${p.id}):`, msg);
        errors.push(`"${p.name}": ${msg}`);
      }

      // Small pause between items
      if (products.length > 1) {
        await new Promise((res) => setTimeout(res, 50));
      }
    }

    // 4. Batch update meta_synced_at for synced products
    if (syncedIds.length > 0) {
      await supabase
        .from('catalog_products')
        .update({ meta_synced_at: now })
        .in('id', syncedIds);
    }

    return NextResponse.json({
      success: true,
      synced,
      failed,
      total: products.length,
      errors: errors.slice(0, 10), // return first 10 errors if any
      synced_at: now,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
