/**
 * Universal Store Adapter Types & Interface definition.
 *
 * Every e-commerce store connector (Zid, Salla, Shopify, WooCommerce, Generic Webhook)
 * implements this single interface.
 */

export interface NormalizedProduct {
  externalId: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  imageUrl: string | null;
  variants: Array<{ label: string; priceModifier?: number }>;
  tags: string[];
  isActive: boolean;
}

export interface NormalizedOrderItem {
  productName: string;
  quantity: number;
  price: number;
}

export interface NormalizedOrderPayload {
  externalOrderId: string;
  customerPhone: string;
  status: 'paid' | 'pending' | 'cancelled';
  totalAmount: number;
  currency: string;
  items?: NormalizedOrderItem[];
}

export interface UniversalStoreAdapter {
  /** Connector type ID matching store_connections.connector_type (e.g. 'zid', 'generic') */
  id: string;
  label: string;

  /** Fetch normalized product list from store API (if supported by platform) */
  fetchProducts?(credentials: Record<string, unknown>): Promise<NormalizedProduct[]>;

  /** Generate store pre-filled checkout link for a cart (if supported by platform) */
  generateCheckoutUrl?(
    credentials: Record<string, unknown>,
    cart: {
      items: Array<{ product_name: string; product_price: number; quantity: number; variant_label?: string | null }>;
      total: number;
      currency: string;
    }
  ): Promise<string | null>;

  /** Parse incoming HTTP webhook request body into a normalized order payload */
  parseOrderWebhook?(
    headers: Headers,
    body: unknown
  ): NormalizedOrderPayload | null;
}
