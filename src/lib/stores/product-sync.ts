/**
 * Universal Store Product Catalog Sync Engine.
 *
 * Pulls products from any connected e-commerce store (Zid, Salla, etc.)
 * via its universal adapter, and upserts them into `catalog_products`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { getStoreAdapter } from './adapters/registry';

export interface SyncResult {
  ok: boolean;
  syncedCount: number;
  error?: string;
}

export async function syncStoreCatalog(
  db: SupabaseClient,
  accountId: string,
  storeConnectionId: string
): Promise<SyncResult> {
  try {
    // 1. Fetch store connection record
    const { data: conn, error: connErr } = await db
      .from('store_connections')
      .select('id, connector_type, credentials_encrypted, is_active')
      .eq('id', storeConnectionId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (connErr || !conn) {
      return { ok: false, syncedCount: 0, error: 'Store connection not found' };
    }
    if (!conn.is_active) {
      return { ok: false, syncedCount: 0, error: 'Store connection is disabled' };
    }

    // 2. Resolve adapter
    const adapter = getStoreAdapter(conn.connector_type);
    if (!adapter || !adapter.fetchProducts) {
      return {
        ok: false,
        syncedCount: 0,
        error: `Connector '${conn.connector_type}' does not support automatic catalog sync.`,
      };
    }

    // 3. Decrypt credentials
    let rawCredentials: Record<string, unknown> = {};
    if (conn.credentials_encrypted) {
      const decrypted = decrypt(conn.credentials_encrypted);
      try {
        rawCredentials = JSON.parse(decrypted);
      } catch {
        rawCredentials = { raw: decrypted };
      }
    }

    // 4. Fetch normalized products
    const products = await adapter.fetchProducts(rawCredentials);
    let count = 0;

    // 5. Upsert products into catalog_products
    for (const p of products) {
      const { error: upsertErr } = await db
        .from('catalog_products')
        .upsert(
          {
            account_id: accountId,
            store_connection_id: storeConnectionId,
            external_product_id: p.externalId,
            name: p.name,
            description: p.description,
            price: p.price,
            currency: p.currency,
            image_url: p.imageUrl,
            variants: p.variants,
            tags: p.tags,
            is_active: p.isActive,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'store_connection_id,external_product_id',
          }
        );

      if (!upsertErr) {
        count++;
      } else {
        console.error(`[product-sync] error upserting ${p.externalId}:`, upsertErr);
      }
    }

    // 6. Update sync timestamp on connection
    await db
      .from('store_connections')
      .update({
        last_products_sync_at: new Date().toISOString(),
        last_products_sync_status: 'ok',
        last_products_sync_error: null,
      })
      .eq('id', storeConnectionId);

    return { ok: true, syncedCount: count };
  } catch (err: any) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[product-sync] catalog sync failed:', err);

    // Record error on connection
    try {
      await db
        .from('store_connections')
        .update({
          last_products_sync_at: new Date().toISOString(),
          last_products_sync_status: 'error',
          last_products_sync_error: errorMsg,
        })
        .eq('id', storeConnectionId);
    } catch {
      // Best effort error state update
    }

    return { ok: false, syncedCount: 0, error: errorMsg };
  }
}
