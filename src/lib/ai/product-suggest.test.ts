import { describe, expect, it } from 'vitest';
import { extractProductMentions, type ProductRef } from './product-suggest';

describe('extractProductMentions', () => {
  const sampleProducts: ProductRef[] = [
    { id: 'p1', name: 'Mineral Foundation Stick', price: 120 },
    { id: 'p2', name: 'Matte Lipstick', price: 65 },
    { id: 'p3', name: 'Hydrating Facial Serum', price: 180 },
    { id: 'p4', name: 'Sunscreen SPF 50', price: 95 },
  ];

  it('returns empty array when text or products are empty', () => {
    expect(extractProductMentions('', sampleProducts)).toEqual([]);
    expect(extractProductMentions('Hello there', [])).toEqual([]);
  });

  it('detects bolded product names wrapped in asterisks', () => {
    const text = 'I recommend our *Mineral Foundation Stick* for full coverage and long wear.';
    const result = extractProductMentions(text, sampleProducts);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p1');
  });

  it('detects unbolded exact product names', () => {
    const text = 'You can pair that with our Hydrating Facial Serum for best results.';
    const result = extractProductMentions(text, sampleProducts);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p3');
  });

  it('detects multiple products and dedupes them', () => {
    const text =
      'We have the *Mineral Foundation Stick* and *Matte Lipstick*. The Matte Lipstick is available in 5 shades!';
    const result = extractProductMentions(text, sampleProducts);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('handles Arabic product names', () => {
    const arabicProducts: ProductRef[] = [
      { id: 'ar1', name: 'سيروم الهيالورونيك', price: 150 },
      { id: 'ar2', name: 'أحمر شفاه مات', price: 80 },
    ];
    const text = 'أنصحك باستخدام *سيروم الهيالورونيك* لترطيب البشرة.';
    const result = extractProductMentions(text, arabicProducts);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ar1');
  });
});
