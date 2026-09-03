import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseCustomerMobile,
  createMyFatoorahPaymentLink,
  type MyFatoorahCredentials,
} from './client';

describe('parseCustomerMobile', () => {
  it('parses Kuwait phone number correctly (+965)', () => {
    const res = parseCustomerMobile('+96598765432');
    expect(res).toEqual({
      mobileCountryCode: '+965',
      customerMobile: '98765432',
    });
  });

  it('parses Saudi phone number correctly (+966)', () => {
    const res = parseCustomerMobile('+966501234567');
    expect(res).toEqual({
      mobileCountryCode: '+966',
      customerMobile: '501234567',
    });
  });

  it('parses UAE phone number correctly (+971)', () => {
    const res = parseCustomerMobile('+971501234567');
    expect(res).toEqual({
      mobileCountryCode: '+971',
      customerMobile: '501234567',
    });
  });

  it('returns null for unknown prefix or invalid length to prevent Invalid data error', () => {
    expect(parseCustomerMobile(null)).toBeNull();
    expect(parseCustomerMobile('')).toBeNull();
    expect(parseCustomerMobile('123')).toBeNull();
    // Nigeria (+234) or non-standard GCC numbers return null (clean fallback)
    expect(parseCustomerMobile('+2348012345678')).toBeNull();
  });
});

describe('createMyFatoorahPaymentLink', () => {
  const creds: MyFatoorahCredentials = {
    api_key: 'test_token',
    environment: 'test',
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('succeeds on first attempt when MyFatoorah returns 200', async () => {
    const mockResponse = {
      IsSuccess: true,
      Data: {
        InvoiceId: 'inv_123',
        InvoiceURL: 'https://demo.myfatoorah.com/pay/inv_123',
      },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const result = await createMyFatoorahPaymentLink(creds, {
      amount: 152.45,
      currency: 'USD',
      customerName: 'Amina',
      customerPhone: '+96598765432',
      callbackUrl: 'https://crm.app/callback',
      errorUrl: 'https://crm.app/error',
    });

    expect(result).toEqual({
      invoiceId: 'inv_123',
      invoiceUrl: 'https://demo.myfatoorah.com/pay/inv_123',
    });

    // Check payload sent
    const calledBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(calledBody.NotificationOption).toBe('LNK');
    expect(calledBody.InvoiceValue).toBe(152.45);
    expect(calledBody.MobileCountryCode).toBe('+965');
    expect(calledBody.CustomerMobile).toBe('98765432');
  });

  it('retries with minimal payload and succeeds if first attempt fails with Invalid data', async () => {
    const failResponse = {
      IsSuccess: false,
      Message: 'Invalid data',
      ValidationErrors: [{ Name: 'CustomerMobile', Error: 'Invalid length' }],
    };

    const successResponse = {
      IsSuccess: true,
      Data: {
        InvoiceId: 'inv_retry_456',
        InvoiceURL: 'https://demo.myfatoorah.com/pay/inv_retry_456',
      },
    };

    // First attempt fails
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => failResponse,
    });

    // Second attempt (retry) succeeds
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => successResponse,
    });

    const result = await createMyFatoorahPaymentLink(creds, {
      amount: 152.45,
      currency: 'USD',
      customerName: 'Amina',
      customerPhone: '+96598765432',
      callbackUrl: 'https://crm.app/callback',
      errorUrl: 'https://crm.app/error',
    });

    expect(result).toEqual({
      invoiceId: 'inv_retry_456',
      invoiceUrl: 'https://demo.myfatoorah.com/pay/inv_retry_456',
    });

    expect((global.fetch as any).mock.calls.length).toBe(2);
    // The retry call only had minimal payload
    const retryBody = JSON.parse((global.fetch as any).mock.calls[1][1].body);
    expect(retryBody.NotificationOption).toBe('LNK');
    expect(retryBody.InvoiceValue).toBe(152.45);
    expect(retryBody.CustomerMobile).toBeUndefined();
  });
});
