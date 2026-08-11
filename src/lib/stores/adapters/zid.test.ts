import { describe, it, expect, vi } from 'vitest';
import { zidAdapter } from './zid';

describe('zidAdapter — parseOrderWebhook', () => {
  it('parses valid Zid order webhook payload with paid status', () => {
    const payload = {
      event: 'order.status.update',
      order: {
        id: '99481',
        order_status: { code: 'paid' },
        order_total: 250.50,
        currency: 'SAR',
        customer: {
          mobile: '966501234567',
        },
      },
    };

    const headers = new Headers();
    const result = zidAdapter.parseOrderWebhook!(headers, payload);

    expect(result).not.toBeNull();
    expect(result?.externalOrderId).toBe('99481');
    expect(result?.customerPhone).toBe('966501234567');
    expect(result?.status).toBe('paid');
    expect(result?.totalAmount).toBe(250.50);
    expect(result?.currency).toBe('SAR');
  });

  it('parses Zid cancelled status correctly', () => {
    const payload = {
      order: {
        id: '12345',
        order_status: { code: 'cancelled' },
        order_total: 100,
        customer: { phone: '+966555555555' },
      },
    };

    const result = zidAdapter.parseOrderWebhook!(new Headers(), payload);
    expect(result?.status).toBe('cancelled');
  });

  it('returns null for missing order id or phone', () => {
    expect(zidAdapter.parseOrderWebhook!(new Headers(), {})).toBeNull();
    expect(zidAdapter.parseOrderWebhook!(new Headers(), { order: { id: '123' } })).toBeNull();
  });
});
