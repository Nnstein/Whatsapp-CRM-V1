/**
 * Payment link resolution.
 *
 * When an account has an active payment connection, this helper creates a
 * real payment link (e.g. MyFatoorah InvoiceURL) for the cart and records
 * the pending invoice in `payment_invoices`.
 *
 * Best-effort: any failure returns null and the caller falls back to
 * manual payment instructions.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { createMyFatoorahPaymentLink } from './myfatoorah/client';
import type { MyFatoorahCredentials } from './myfatoorah/client';

export interface PaymentCartShape {
  items: Array<{
    product_name: string;
    product_price: number;
    quantity: number;
    variant_label?: string | null;
  }>;
  total: number;
  currency: string;
}

export interface PaymentLinkResult {
  url: string;
  connectionId: string;
  invoiceRowId: string;
}

/**
 * Find the active payment connection for this account, generate a payment
 * link, persist a pending invoice row, and return the link URL.
 *
 * @param db          Service-role Supabase client
 * @param accountId   The account to look up connections for
 * @param cart        Cart contents for amount + items
 * @param cartId      UUID of the whatsapp_carts row (optional)
 * @param contact     Customer info for the payment page
 * @param appUrl      Public base URL of this deployment (optional, defaults to process.env.APP_URL)
 */
export async function getPaymentLink(
  db: SupabaseClient,
  accountId: string,
  cart: PaymentCartShape,
  cartId: string | null,
  contact: { id: string; name?: string | null; phone?: string | null; email?: string | null },
  conversationId: string | null,
  appUrl?: string,
): Promise<PaymentLinkResult | null> {
  const resolvedAppUrl = (
    appUrl ||
    process.env.APP_URL ||
    'https://whatsapp-crm-v1.onrender.com'
  ).replace(/\/$/, '');

  try {
    const { data: connections } = await db
      .from('payment_connections')
      .select('id, connector_type, credentials_encrypted, webhook_secret')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (!connections || connections.length === 0) return null;

    for (const conn of connections) {
      if (!conn.credentials_encrypted) continue;

      let credentials: Record<string, unknown>;
      try {
        credentials = JSON.parse(decrypt(conn.credentials_encrypted));
      } catch {
        continue;
      }

      if (conn.connector_type === 'myfatoorah') {
        // Build callback URL — embed both the invoice reference and the
        // account's webhook_secret so the callback can look up this connection.
        const callbackBase = `${resolvedAppUrl}/api/v1/webhooks/payments/myfatoorah/callback`;
        const callbackUrl = `${callbackBase}?token=${conn.webhook_secret ?? ''}`;
        const errorUrl = `${resolvedAppUrl}/pay/result?status=failed`;

        const result = await createMyFatoorahPaymentLink(
          (credentials as unknown) as MyFatoorahCredentials,
          {
            amount: cart.total,
            currency: cart.currency,
            customerName: contact.name ?? 'Customer',
            customerPhone: contact.phone ?? undefined,
            customerEmail: contact.email ?? undefined,
            callbackUrl,
            errorUrl,
            items: cart.items.map((item) => ({
              name: item.variant_label
                ? `${item.product_name} (${item.variant_label})`
                : item.product_name,
              quantity: item.quantity,
              unitPrice: item.product_price,
            })),
          },
        );

        // Persist the pending invoice row (service-role bypasses RLS).
        const { data: invoiceRow, error: insertErr } = await db
          .from('payment_invoices')
          .insert({
            account_id: accountId,
            payment_connection_id: conn.id,
            cart_id: cartId,
            contact_id: contact.id,
            conversation_id: conversationId,
            external_invoice_id: result.invoiceId,
            invoice_url: result.invoiceUrl,
            amount: cart.total,
            currency: cart.currency,
            status: 'pending',
          })
          .select('id')
          .single();

        if (insertErr) {
          console.error('[payment-link] invoice insert error:', insertErr);
          // Still return the URL — the payment works even if the DB record fails.
        }

        return {
          url: result.invoiceUrl,
          connectionId: conn.id,
          invoiceRowId: invoiceRow?.id ?? '',
        };
      }

      // Future gateways: add their dispatch here following the same pattern.
    }

    return null;
  } catch (err) {
    console.error('[payment-link] resolution failed:', err);
    return null;
  }
}
