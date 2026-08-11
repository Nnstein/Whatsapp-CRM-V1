/**
 * Zid Universal Store Adapter.
 *
 * Implements `UniversalStoreAdapter` for Zid stores using Merchant Dashboard tokens.
 */

import type { UniversalStoreAdapter, NormalizedProduct, NormalizedOrderPayload } from './types';
import { parseZidCredentials } from '../zid/client';

const ZID_API_BASE = 'https://api.zid.sa/v1';

export const zidAdapter: UniversalStoreAdapter = {
  id: 'zid',
  label: 'Zid',

  async fetchProducts(credentials: Record<string, unknown>): Promise<NormalizedProduct[]> {
    const jsonStr = typeof credentials === 'string' ? credentials : JSON.stringify(credentials);
    const { auth_token, manager_token } = parseZidCredentials(jsonStr);

    const response = await fetch(`${ZID_API_BASE}/managers/store/products?page=1&per_page=50`, {
      method: 'GET',
      headers: {
        Authorization: auth_token.trim(),
        'X-Manager-Token': manager_token.trim(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Zid API error (HTTP ${response.status}) when fetching products.`);
    }

    const body = await response.json();
    const rawProducts = Array.isArray(body?.products)
      ? body.products
      : Array.isArray(body?.data?.products)
      ? body.data.products
      : Array.isArray(body?.results)
      ? body.results
      : [];

    return rawProducts.map((p: any): NormalizedProduct => {
      // Resolve localized name
      let name = 'Unnamed Product';
      if (typeof p.name === 'string') name = p.name;
      else if (p.name && typeof p.name === 'object') {
        name = p.name.ar || p.name.en || Object.values(p.name)[0] || 'Unnamed Product';
      }

      // Resolve description
      let description: string | null = null;
      if (typeof p.description === 'string') description = p.description;
      else if (p.description && typeof p.description === 'object') {
        description = p.description.ar || p.description.en || null;
      }

      // Resolve price
      const price = typeof p.price === 'number' ? p.price : parseFloat(String(p.price || '0')) || 0;

      // Resolve primary image
      let imageUrl: string | null = null;
      if (Array.isArray(p.images) && p.images.length > 0) {
        imageUrl = typeof p.images[0] === 'string' ? p.images[0] : p.images[0]?.url || p.images[0]?.image || null;
      } else if (typeof p.image === 'string') {
        imageUrl = p.image;
      }

      // Resolve variants
      const variants: Array<{ label: string; priceModifier?: number }> = [];
      if (Array.isArray(p.variants)) {
        for (const v of p.variants) {
          const vName = typeof v.name === 'string' ? v.name : v.name?.ar || v.name?.en || String(v.id || '');
          if (vName) variants.push({ label: vName, priceModifier: v.price ? Number(v.price) - price : 0 });
        }
      }

      // Resolve tags
      const tags: string[] = [];
      if (Array.isArray(p.categories)) {
        for (const cat of p.categories) {
          const cName = typeof cat.name === 'string' ? cat.name : cat.name?.ar || cat.name?.en;
          if (cName) tags.push(cName);
        }
      }

      return {
        externalId: String(p.id || p.slug || Math.random()),
        name,
        description,
        price,
        currency: p.currency || 'SAR',
        imageUrl,
        variants,
        tags,
        isActive: p.is_active !== false && p.is_published !== false,
      };
    });
  },

  async generateCheckoutUrl(credentials: Record<string, unknown>, cart): Promise<string | null> {
    // If store URL is known or provided in credentials, return formatted URL
    const storeUrl = typeof credentials.store_url === 'string' ? credentials.store_url.trim() : null;
    if (storeUrl) {
      return `${storeUrl.replace(/\/+$/, '')}/cart`;
    }
    return null;
  },

  parseOrderWebhook(headers: Headers, body: unknown): NormalizedOrderPayload | null {
    if (!body || typeof body !== 'object') return null;

    const payload = body as Record<string, any>;
    const order = payload.order || payload.data || payload;

    const externalOrderId = String(order.id || order.code || order.order_id || '');
    if (!externalOrderId) return null;

    // Mobile phone from Zid order customer
    const mobile =
      order.customer?.mobile ||
      order.customer?.phone ||
      order.shipping_address?.phone ||
      order.mobile ||
      '';

    if (!mobile) return null;

    // Status mapping
    const statusCode = String(order.order_status?.code || order.status || '').toLowerCase();
    let status: 'paid' | 'pending' | 'cancelled' = 'pending';
    if (['paid', 'completed', 'delivered', 'processing', 'ready_for_shipping', 'shipped'].includes(statusCode)) {
      status = 'paid';
    } else if (['cancelled', 'canceled', 'refunded', 'failed'].includes(statusCode)) {
      status = 'cancelled';
    }

    const totalAmount = typeof order.order_total === 'number'
      ? order.order_total
      : parseFloat(String(order.order_total || order.total || '0')) || 0;

    return {
      externalOrderId,
      customerPhone: String(mobile),
      status,
      totalAmount,
      currency: order.currency || 'SAR',
    };
  },
};
