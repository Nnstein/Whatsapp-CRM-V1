import { describe, it, expect } from 'vitest';
import {
  classifyCartIntent,
  resolveProductFromMessage,
  parseQuantity,
  extractProductHint,
  extractVariantHint,
  type CatalogProductRef,
} from './cart-intent';

// ─────────────────────────────────────────────────────────────
// classifyCartIntent
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// extractProductHint
// ─────────────────────────────────────────────────────────────

describe('extractProductHint', () => {
  it('strips English intent prefixes', () => {
    expect(extractProductHint('I want the Red Lipstick')).toBe('Red Lipstick');
    expect(extractProductHint("I'll take the moisturiser")).toBe('moisturiser');
    expect(extractProductHint('add the shampoo')).toBe('shampoo');
  });

  it('strips Arabic intent prefixes', () => {
    expect(extractProductHint('أبغى الشامبو')).toBe('الشامبو');
    expect(extractProductHint('أريد كريم الوجه')).toBe('كريم الوجه');
  });

  it('falls back to full text when no prefix matches', () => {
    expect(extractProductHint('Red Lipstick')).toBe('Red Lipstick');
  });
});

// ─────────────────────────────────────────────────────────────
// resolveProductFromMessage
// ─────────────────────────────────────────────────────────────

const PRODUCTS: CatalogProductRef[] = [
  { id: 'p1', name: 'Red Lipstick', price: 50 },
  { id: 'p2', name: 'Moisturising Face Cream', price: 120 },
  { id: 'p3', name: 'Hair Shampoo', price: 35, variants: [{ label: 'Dry' }, { label: 'Oily' }] },
  { id: 'p4', name: 'Sunscreen SPF 50', price: 90 },
  { id: 'p5', name: 'Eye Shadow Palette', price: 200 },
];

describe('resolveProductFromMessage — catalog number', () => {
  it('resolves "product 1" to the first product', () => {
    const r = resolveProductFromMessage('I want product 1', PRODUCTS);
    expect(r?.product.id).toBe('p1');
  });

  it('resolves a plain digit "2" against lastShownProducts', () => {
    const shown = [PRODUCTS[3], PRODUCTS[0]]; // SPF, Lipstick
    const r = resolveProductFromMessage('2', PRODUCTS, shown);
    expect(r?.product.id).toBe('p1'); // 2nd in shown list
  });

  it('resolves Arabic-Indic digit رقم ٢', () => {
    const r = resolveProductFromMessage('رقم ٢', PRODUCTS);
    expect(r?.product.id).toBe('p2');
  });

  it('returns null for out-of-range number', () => {
    const r = resolveProductFromMessage('product 99', PRODUCTS);
    expect(r).toBeNull();
  });
});

describe('resolveProductFromMessage — name matching', () => {
  it('exact match', () => {
    const r = resolveProductFromMessage('I want the Red Lipstick', PRODUCTS);
    expect(r?.product.id).toBe('p1');
  });

  it('case-insensitive match', () => {
    const r = resolveProductFromMessage('red lipstick', PRODUCTS);
    expect(r?.product.id).toBe('p1');
  });

  it('fuzzy partial match (>= 0.5 score)', () => {
    const r = resolveProductFromMessage('I want the shampoo', PRODUCTS);
    expect(r?.product.id).toBe('p3');
  });

  it('returns null when nothing is confident', () => {
    const r = resolveProductFromMessage('I want that thing', PRODUCTS);
    expect(r).toBeNull();
  });
});

describe('resolveProductFromMessage — variant hint', () => {
  it('extracts variant from the message', () => {
    const r = resolveProductFromMessage('I want the Oily shampoo', PRODUCTS);
    expect(r?.product.id).toBe('p3');
    expect(r?.variantHint).toBe('Oily');
  });

  it('returns empty variantHint when variant not mentioned', () => {
    const r = resolveProductFromMessage('I want the red lipstick', PRODUCTS);
    expect(r?.variantHint).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────
// parseQuantity
// ─────────────────────────────────────────────────────────────

describe('parseQuantity', () => {
  it('parses explicit numbers', () => {
    expect(parseQuantity('I want 3 of the lipstick')).toBe(3);
    expect(parseQuantity('add 2 moisturiser')).toBe(2);
    expect(parseQuantity('× 5 shampoo')).toBe(5);
  });

  it('parses written-out word numbers', () => {
    expect(parseQuantity('I want two of those')).toBe(2);
    expect(parseQuantity('give me five')).toBe(5);
  });

  it('parses Arabic-Indic digits', () => {
    expect(parseQuantity('أبغى ٣ من الشامبو')).toBe(3);
  });

  it('defaults to 1 when no quantity found', () => {
    expect(parseQuantity('I want the lipstick')).toBe(1);
    expect(parseQuantity('add to cart')).toBe(1);
  });

  it('rejects out-of-range values (> 100)', () => {
    expect(parseQuantity('I want 999 items')).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// extractVariantHint
// ─────────────────────────────────────────────────────────────

describe('extractVariantHint', () => {
  const productWithVariants: CatalogProductRef = {
    id: 'p3',
    name: 'Hair Shampoo',
    price: 35,
    variants: [{ label: 'Dry' }, { label: 'Oily' }],
  };

  it('matches a variant label in the text', () => {
    expect(extractVariantHint('I want the dry shampoo', productWithVariants)).toBe('Dry');
  });

  it('returns empty string when no variant found', () => {
    expect(extractVariantHint('I want the shampoo', productWithVariants)).toBe('');
  });

  it('returns empty string for a product with no variants', () => {
    const p: CatalogProductRef = { id: 'p1', name: 'Red Lipstick', price: 50 };
    expect(extractVariantHint('I want the oily red lipstick', p)).toBe('');
  });
});
