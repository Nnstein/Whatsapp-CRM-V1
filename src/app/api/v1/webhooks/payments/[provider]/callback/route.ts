import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { getMyFatoorahPaymentStatus } from '@/lib/payments/myfatoorah/client';
import type { MyFatoorahCredentials } from '@/lib/payments/myfatoorah/client';
import { engineSendText } from '@/lib/flows/meta-send';

function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

/**
 * GET /api/v1/webhooks/payments/[provider]/callback
 *
 * MyFatoorah (and future gateways) redirects the customer's browser here
 * after payment succeeds. The URL is:
 *
 *   /api/v1/webhooks/payments/myfatoorah/callback
 *     ?token=<webhook_secret>     ← identifies the payment_connection
 *     &paymentId=<PaymentId>      ← MyFatoorah payment identifier
 *
 * Flow:
 *   1. Validate token → resolve payment_connection + account
 *   2. Find the pending payment_invoice by external_invoice_id
 *      (we store the InvoiceId; MyFatoorah callback gives us PaymentId —
 *       we call GetPaymentStatus with PaymentId to verify)
 *   3. Call GetPaymentStatus → confirm payment is PAID
 *   4. Mark invoice as paid
 *   5. If invoice has a cart_id → mark cart as confirmed
 *   6. Send a WhatsApp "Payment received ✅" message
 *   7. Redirect the customer's browser to /pay/result?status=success
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const paymentId = url.searchParams.get('paymentId');

  const appUrl =
    process.env.APP_URL?.replace(/\/$/, '') ??
    (request.headers.get('x-forwarded-host')
      ? `https://${request.headers.get('x-forwarded-host')}`
      : url.origin);

  const successRedirect = `${appUrl}/pay/result?status=success`;
  const failedRedirect = `${appUrl}/pay/result?status=failed`;

  // ── Token validation ────────────────────────────────────────────
  if (!token) {
    console.error(`[payments/callback/${provider}] missing token`);
    return Response.redirect(failedRedirect, 302);
  }

  const db = supabaseAdmin();

  const { data: conn } = await db
    .from('payment_connections')
    .select('id, account_id, connector_type, credentials_encrypted')
    .eq('webhook_secret', token)
    .eq('is_active', true)
    .maybeSingle();

  if (!conn) {
    console.error(`[payments/callback/${provider}] no connection found for token`);
    return Response.redirect(failedRedirect, 302);
  }

  if (conn.connector_type !== provider) {
    console.error(`[payments/callback/${provider}] provider mismatch: ${conn.connector_type}`);
    return Response.redirect(failedRedirect, 302);
  }

  // ── Verify payment with gateway ────────────────────────────────
  if (!paymentId) {
    console.error(`[payments/callback/${provider}] missing paymentId`);
    return Response.redirect(failedRedirect, 302);
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(decrypt(conn.credentials_encrypted));
  } catch {
    console.error(`[payments/callback/${provider}] credentials decrypt failed`);
    return Response.redirect(failedRedirect, 302);
  }

  let isPaid = false;
  let rawData: Record<string, unknown> = {};

  try {
    if (provider === 'myfatoorah') {
      const status = await getMyFatoorahPaymentStatus(
        (credentials as unknown) as MyFatoorahCredentials,
        paymentId,
      );
      isPaid = status.isPaid;
      rawData = status.rawData;
      console.log(`[payments/callback/myfatoorah] status=${status.invoiceStatus} paid=${isPaid}`);
    } else {
      console.error(`[payments/callback] unsupported provider: ${provider}`);
      return Response.redirect(failedRedirect, 302);
    }
  } catch (err) {
    console.error(`[payments/callback/${provider}] status check failed:`, err);
    return Response.redirect(failedRedirect, 302);
  }

  // ── Find the pending invoice ───────────────────────────────────
  // MyFatoorah's callback gives us PaymentId; we stored InvoiceId.
  // GetPaymentStatus returns InvoiceId in rawData so we can match.
  const externalInvoiceId = String(rawData.InvoiceId ?? rawData.invoiceId ?? '');

  const { data: invoice } = await db
    .from('payment_invoices')
    .select('id, cart_id, contact_id, conversation_id, status')
    .eq('payment_connection_id', conn.id)
    .eq('external_invoice_id', externalInvoiceId)
    .maybeSingle();

  if (!invoice) {
    console.warn(`[payments/callback/${provider}] no invoice found for InvoiceId=${externalInvoiceId}`);
    // Payment may be valid but we can't link it — still redirect to success.
    return Response.redirect(isPaid ? successRedirect : failedRedirect, 302);
  }

  // Already processed (idempotency guard).
  if (invoice.status === 'paid') {
    return Response.redirect(successRedirect, 302);
  }

  const newStatus = isPaid ? 'paid' : 'failed';
  const now = new Date().toISOString();

  // ── Update invoice status ─────────────────────────────────────
  await db
    .from('payment_invoices')
    .update({
      status: newStatus,
      external_payment_id: paymentId,
      paid_at: isPaid ? now : null,
      gateway_response: rawData,
    })
    .eq('id', invoice.id);

  if (!isPaid) {
    return Response.redirect(failedRedirect, 302);
  }

  // ── Auto-confirm the linked cart ──────────────────────────────
  if (invoice.cart_id) {
    await db
      .from('whatsapp_carts')
      .update({ status: 'confirmed', confirmed_at: now })
      .eq('id', invoice.cart_id)
      .eq('status', 'checkout_sent'); // only if still awaiting payment
  }

  // ── Send WhatsApp confirmation message ────────────────────────
  if (invoice.contact_id && invoice.conversation_id) {
    try {
      await engineSendText({
        accountId: conn.account_id,
        userId: null,
        conversationId: invoice.conversation_id,
        contactId: invoice.contact_id,
        text: '✅ *Payment received!* Thank you — your order is confirmed. We\'ll be in touch shortly. 🙏',
      });
    } catch (err) {
      // Non-fatal — the payment is confirmed, just the message failed.
      console.warn(`[payments/callback/${provider}] WhatsApp confirmation failed:`, err);
    }
  }

  console.log(`[payments/callback/${provider}] Invoice ${invoice.id} marked paid. Cart confirmed.`);
  return Response.redirect(successRedirect, 302);
}
