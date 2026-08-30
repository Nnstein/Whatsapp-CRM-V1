/**
 * MyFatoorah API client.
 *
 * Implements three operations:
 *   1. testConnection  — verifies API key via InitiatePayment probe
 *   2. createPaymentLink — calls SendPayment, returns InvoiceURL + InvoiceId
 *   3. getPaymentStatus  — calls GetPaymentStatus to verify after callback
 *
 * Authentication
 * ──────────────
 * All requests use a single Bearer token (the "API Key" from
 * MyFatoorah Portal → Integration Settings → API Key).
 *
 * Base URLs
 * ─────────
 * Test:  https://apitest.myfatoorah.com   (works for any country)
 * Live:  region-specific (see LIVE_BASE_URLS below)
 *
 * Docs: https://docs.myfatoorah.com
 */

import type { TestPaymentResult, CreatePaymentLinkRequest, CreatePaymentLinkResult } from '../types';

/** ISO country code → MyFatoorah live API base URL. */
const LIVE_BASE_URLS: Record<string, string> = {
  KWT: 'https://api-kw.myfatoorah.com',
  SAU: 'https://api-sa.myfatoorah.com',
  ARE: 'https://api-ae.myfatoorah.com',
  QAT: 'https://api-qa.myfatoorah.com',
  BHR: 'https://api-bh.myfatoorah.com',
  OMN: 'https://api-om.myfatoorah.com',
  EGY: 'https://api-eg.myfatoorah.com',
  JOR: 'https://api-jo.myfatoorah.com',
};

const TEST_BASE_URL = 'https://apitest.myfatoorah.com';

export interface MyFatoorahCredentials {
  /** Bearer token API key from MyFatoorah Portal. */
  api_key: string;
  /** 'test' or 'live'. Defaults to 'test' if missing. */
  environment?: string;
  /** ISO country code — required when environment is 'live'. */
  country_iso?: string;
}

function getBaseUrl(creds: MyFatoorahCredentials): string {
  const env = (creds.environment ?? 'test').toLowerCase().trim();
  if (env !== 'live') return TEST_BASE_URL;

  const iso = (creds.country_iso ?? '').toUpperCase().trim();
  return LIVE_BASE_URLS[iso] ?? TEST_BASE_URL;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * Verify credentials by calling InitiatePayment with a minimal probe.
 * A 200 response with IsSuccess=true confirms the API key is valid.
 */
export async function testMyFatoorahConnection(
  credentials: MyFatoorahCredentials,
): Promise<TestPaymentResult> {
  const { api_key } = credentials;

  if (!api_key?.trim()) {
    return { ok: false, error: 'API Key is required.' };
  }

  const base = getBaseUrl(credentials);

  let response: Response;
  try {
    response = await fetch(`${base}/v2/InitiatePayment`, {
      method: 'POST',
      headers: authHeaders(api_key),
      body: JSON.stringify({ InvoiceAmount: 1, CurrencyIso: 'KWD' }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    const msg =
      err instanceof Error && err.name === 'TimeoutError'
        ? 'Request timed out — check your network or the MyFatoorah API status.'
        : `Network error: ${err instanceof Error ? err.message : String(err)}`;
    return { ok: false, error: msg };
  }

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: `MyFatoorah returned HTTP ${response.status} with no JSON body.` };
  }

  if (response.ok && body.IsSuccess === true) {
    return { ok: true, gatewayName: 'MyFatoorah' };
  }

  const statusMessages: Record<number, string> = {
    401: 'Unauthorized — check your API Key. Make sure you are using the correct environment (test vs live).',
    403: 'Forbidden — the API Key does not have permission for this operation.',
    404: 'Endpoint not found — country_iso may be incorrect.',
    429: 'Rate limited by MyFatoorah — wait a moment and try again.',
  };

  const errMsg = statusMessages[response.status] ?? `MyFatoorah returned HTTP ${response.status}.`;
  const apiError = (body as { Message?: string }).Message;
  return { ok: false, error: apiError ? `${errMsg} — ${apiError}` : errMsg };
}

/**
 * Create a payment link via MyFatoorah SendPayment.
 *
 * Uses NotificationOption: 'LNK' — returns the InvoiceURL only,
 * without sending any email/SMS from MyFatoorah's side. We send the link
 * to the customer ourselves via WhatsApp.
 *
 * Throws on network/API errors so the caller can catch and handle.
 */
export async function createMyFatoorahPaymentLink(
  credentials: MyFatoorahCredentials,
  req: CreatePaymentLinkRequest,
): Promise<CreatePaymentLinkResult> {
  const { api_key } = credentials;
  const base = getBaseUrl(credentials);

  const payload: Record<string, unknown> = {
    NotificationOption: 'LNK',
    InvoiceValue: req.amount,
    CustomerName: req.customerName,
    DisplayCurrencyIso: req.currency,
    CallBackUrl: req.callbackUrl,
    ErrorUrl: req.errorUrl,
    Language: 'en',
  };

  if (req.customerPhone) payload.MobileCountryCode = '+965'; // TODO: derive from phone
  if (req.customerPhone) payload.CustomerMobile = req.customerPhone.replace(/^\+/, '');
  if (req.customerEmail) payload.CustomerEmail = req.customerEmail;
  if (req.customerReference) payload.CustomerReference = req.customerReference;

  if (req.items && req.items.length > 0) {
    payload.InvoiceItems = req.items.map((item) => ({
      ItemName: item.name,
      Quantity: item.quantity,
      UnitPrice: item.unitPrice,
    }));
  }

  const response = await fetch(`${base}/v2/SendPayment`, {
    method: 'POST',
    headers: authHeaders(api_key),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok || body.IsSuccess !== true) {
    const msg = String(
      (body as { Message?: string }).Message ?? `MyFatoorah SendPayment HTTP ${response.status}`,
    );
    throw new Error(msg);
  }

  const data = (body.Data ?? {}) as Record<string, unknown>;
  const invoiceId = String(data.InvoiceId ?? '');
  const invoiceUrl = String(data.InvoiceURL ?? '');

  if (!invoiceId || !invoiceUrl) {
    throw new Error('MyFatoorah SendPayment response missing InvoiceId or InvoiceURL.');
  }

  return { invoiceId, invoiceUrl };
}

/**
 * Verify payment status after the customer completes (or abandons) checkout.
 * Returns the raw Data object from GetPaymentStatus so the caller can
 * check InvoiceStatus, and extract external_payment_id.
 */
export async function getMyFatoorahPaymentStatus(
  credentials: MyFatoorahCredentials,
  paymentId: string,
): Promise<{ isPaid: boolean; invoiceStatus: string; rawData: Record<string, unknown> }> {
  const { api_key } = credentials;
  const base = getBaseUrl(credentials);

  const response = await fetch(`${base}/v2/GetPaymentStatus`, {
    method: 'POST',
    headers: authHeaders(api_key),
    body: JSON.stringify({ Key: paymentId, KeyType: 'PaymentId' }),
    signal: AbortSignal.timeout(12_000),
  });

  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok || body.IsSuccess !== true) {
    throw new Error(
      String((body as { Message?: string }).Message ?? `GetPaymentStatus HTTP ${response.status}`),
    );
  }

  const data = (body.Data ?? {}) as Record<string, unknown>;
  const invoiceStatus = String(data.InvoiceStatus ?? 'unknown').toUpperCase();

  return {
    isPaid: invoiceStatus === 'PAID',
    invoiceStatus,
    rawData: data,
  };
}
