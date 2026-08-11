import { describe, it, expect } from 'vitest';
import { classifyCartIntent } from './cart-intent';

describe('classifyCartIntent — browse_catalog', () => {
  it('matches English product browsing', () => {
    expect(classifyCartIntent('Show me your products')).toBe('browse_catalog');
    expect(classifyCartIntent('what do you have')).toBe('browse_catalog');
    expect(classifyCartIntent('what do you sell?')).toBe('browse_catalog');
    expect(classifyCartIntent("What's available?")).toBe('browse_catalog');
  });

  it('matches Arabic Gulf browsing', () => {
    expect(classifyCartIntent('أرني منتجاتك')).toBe('browse_catalog');
    expect(classifyCartIntent('شو عندك')).toBe('browse_catalog');
    expect(classifyCartIntent('ايش عندك')).toBe('browse_catalog');
    expect(classifyCartIntent('المنتجات')).toBe('browse_catalog');
  });

  it('matches Hindi browsing', () => {
    expect(classifyCartIntent('kya hai')).toBe('browse_catalog');
    expect(classifyCartIntent('product dikhao')).toBe('browse_catalog');
  });
});

describe('classifyCartIntent — view_cart', () => {
  it('matches English cart viewing', () => {
    expect(classifyCartIntent('my cart')).toBe('view_cart');
    expect(classifyCartIntent("What's in my cart?")).toBe('view_cart');
    expect(classifyCartIntent('show my cart')).toBe('view_cart');
    expect(classifyCartIntent('cart summary')).toBe('view_cart');
    expect(classifyCartIntent('order summary')).toBe('view_cart');
  });

  it('matches Arabic cart viewing', () => {
    expect(classifyCartIntent('سلتي')).toBe('view_cart');
    expect(classifyCartIntent('ايش في سلتي')).toBe('view_cart');
    expect(classifyCartIntent('شوف طلبي')).toBe('view_cart');
  });

  it('matches Hindi cart viewing', () => {
    expect(classifyCartIntent('mera cart')).toBe('view_cart');
    expect(classifyCartIntent('cart dikhao')).toBe('view_cart');
  });
});

describe('classifyCartIntent — checkout', () => {
  it('matches English checkout', () => {
    expect(classifyCartIntent('checkout')).toBe('checkout');
    expect(classifyCartIntent('pay now')).toBe('checkout');
    expect(classifyCartIntent("I'm ready to pay")).toBe('checkout');
    expect(classifyCartIntent('place my order')).toBe('checkout');
    expect(classifyCartIntent("that's all")).toBe('checkout');
  });

  it('matches Arabic checkout', () => {
    expect(classifyCartIntent('ادفع')).toBe('checkout');
    expect(classifyCartIntent('أبغى أدفع')).toBe('checkout');
    expect(classifyCartIntent('إتمام الشراء')).toBe('checkout');
    expect(classifyCartIntent('خلصت')).toBe('checkout');
  });

  it('matches Hindi checkout', () => {
    expect(classifyCartIntent('checkout karo')).toBe('checkout');
    expect(classifyCartIntent('payment karo')).toBe('checkout');
    expect(classifyCartIntent('order karo')).toBe('checkout');
  });
});

describe('classifyCartIntent — clear_cart', () => {
  it('matches English cart clearing', () => {
    expect(classifyCartIntent('clear my cart')).toBe('clear_cart');
    expect(classifyCartIntent('cancel my order')).toBe('clear_cart');
    expect(classifyCartIntent('start over')).toBe('clear_cart');
    expect(classifyCartIntent('empty my cart')).toBe('clear_cart');
  });

  it('matches Arabic cart clearing', () => {
    expect(classifyCartIntent('إلغاء الطلب')).toBe('clear_cart');
    expect(classifyCartIntent('ألغِ طلبي')).toBe('clear_cart');
  });

  it('matches Hindi cart clearing', () => {
    expect(classifyCartIntent('cancel karo')).toBe('clear_cart');
  });
});

describe('classifyCartIntent — no match', () => {
  it('returns null for unrelated messages', () => {
    expect(classifyCartIntent('Hello!')).toBeNull();
    expect(classifyCartIntent('What are your opening hours?')).toBeNull();
    expect(classifyCartIntent('thank you')).toBeNull();
    expect(classifyCartIntent('')).toBeNull();
  });
});
