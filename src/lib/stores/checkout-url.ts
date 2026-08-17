/**
 * Store checkout URL resolution.
 *
 * When the account has an active store connection whose adapter supports
 * `generateCheckoutUrl`, we build a store-native checkout link for the
 * cart and include it in the WhatsApp payment message — the customer taps
 * through to pay on the merchant's own store instead of reading manual
 * payment instructions.
 *
 * Best-effort: any failure (no connection, adapter unsupported, decrypt
 * error) returns null and the caller falls back to the plain payment
 * instructions message.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getStoreAdapter } from '@/lib/stores/adapters/registry';
import { decrypt } from '@/lib/whatsapp/encryption';

export interface CheckoutCartShape {
  items: Array<{
    product_name: string;
    product_price: number;
    quantity: number;
    variant_label?: string | null;
  }>;
  total: number;
  currency: string;
}

export async function getStoreCheckoutUrl(
  db: SupabaseClient,
  accountId: string,
  cart: CheckoutCartShape,
): Promise<{ url: string; connectionId: string } | null> {
  try {
    // Newest active connection wins; adapters without generateCheckoutUrl
    // (e.g. generic webhook-only stores) are skipped below.
    const { data: connections } = await db
      .from('store_connections')
      .select('id, connector_type, credentials_encrypted')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (!connections || connections.length === 0) return null;

    for (const conn of connections) {
      const adapter = getStoreAdapter(conn.connector_type);
      if (!adapter?.generateCheckoutUrl || !conn.credentials_encrypted) continue;

      let credentials: Record<string, unknown>;
      try {
        credentials = JSON.parse(decrypt(conn.credentials_encrypted));
      } catch {
        continue; // undecryptable credentials — skip this connection
      }

      const url = await adapter.generateCheckoutUrl(credentials, cart);
      if (url) return { url, connectionId: conn.id };
    }

    return null;
  } catch (err) {
    console.error('[checkout-url] resolution failed:', err);
    return null;
  }
}
