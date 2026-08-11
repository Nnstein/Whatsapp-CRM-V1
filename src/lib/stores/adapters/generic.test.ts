import { describe, it, expect } from 'vitest';
import { genericAdapter, generateStorePixelSnippet } from './generic';

describe('genericAdapter — parseOrderWebhook', () => {
  it('parses generic JSON order payload', () => {
    const payload = {
      order_id: 'ORD-7712',
      customer_phone: '+966509998877',
      status: 'completed',
      total: 180.00,
      currency: 'SAR',
    };

    const result = genericAdapter.parseOrderWebhook!(new Headers(), payload);

    expect(result).not.toBeNull();
    expect(result?.externalOrderId).toBe('ORD-7712');
    expect(result?.customerPhone).toBe('+966509998877');
    expect(result?.status).toBe('paid');
    expect(result?.totalAmount).toBe(180.00);
    expect(result?.currency).toBe('SAR');
  });

  it('returns null if missing required fields', () => {
    expect(genericAdapter.parseOrderWebhook!(new Headers(), { order_id: '123' })).toBeNull();
  });
});

describe('generateStorePixelSnippet', () => {
  it('generates snippet with token and apiRoot', () => {
    const snippet = generateStorePixelSnippet('test_token', 'https://crm.example.com');
    expect(snippet).toContain('https://crm.example.com/api/v1/webhooks/stores/generic?token=test_token');
    expect(snippet).toContain('WACRM');
  });
});
