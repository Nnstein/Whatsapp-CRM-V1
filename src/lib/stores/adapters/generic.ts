/**
 * Generic Universal Store Adapter.
 *
 * Enables any custom website, WooCommerce, Wix, or custom API to integrate
 * with the WhatsApp CRM via standard HTTP webhook JSON payloads.
 */

import type { UniversalStoreAdapter, NormalizedOrderPayload } from './types';

export const genericAdapter: UniversalStoreAdapter = {
  id: 'generic',
  label: 'Custom Webhook / Generic Store',

  parseOrderWebhook(headers: Headers, body: unknown): NormalizedOrderPayload | null {
    if (!body || typeof body !== 'object') return null;

    const p = body as Record<string, any>;

    // Expects { order_id, phone | customer_phone, status?, total? }
    const externalOrderId = String(p.order_id || p.id || p.external_order_id || '');
    const customerPhone = String(p.customer_phone || p.phone || p.mobile || p.contact_phone || '');

    if (!externalOrderId || !customerPhone) return null;

    const rawStatus = String(p.status || 'paid').toLowerCase();
    let status: 'paid' | 'pending' | 'cancelled' = 'pending';
    if (['paid', 'completed', 'success', 'confirmed', 'processing'].includes(rawStatus)) {
      status = 'paid';
    } else if (['cancelled', 'canceled', 'refunded', 'failed'].includes(rawStatus)) {
      status = 'cancelled';
    }

    const totalAmount = typeof p.total === 'number'
      ? p.total
      : parseFloat(String(p.total || p.total_amount || p.amount || '0')) || 0;

    return {
      externalOrderId,
      customerPhone,
      status,
      totalAmount,
      currency: String(p.currency || 'SAR').toUpperCase(),
    };
  },
};

/**
 * Generate client-side tracking JS snippet for custom e-commerce stores.
 */
export function generateStorePixelSnippet(accountToken: string, apiRoot: string): string {
  return `<!-- WhatsApp CRM Store Webhook Snippet -->
<script>
  (function(w,d,s,t){
    w.WACRM = w.WACRM || {
      trackOrder: function(orderData) {
        return fetch('${apiRoot}/api/v1/webhooks/stores/generic?token=${accountToken}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderData)
        });
      }
    };
  })(window,document);
</script>`;
}
