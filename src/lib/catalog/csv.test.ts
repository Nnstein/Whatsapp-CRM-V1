import { describe, it, expect } from 'vitest';
import { parseCatalogCsv, exportCatalogCsv } from './csv';

const SAMPLE_ZID_CSV = `sku,has_variant,name_en,description_en,quantity,categories_en,weight,weight_unit,option1_name_en,option1_value_en,price,sale_price,cost,images
MF,Yes,Mineral Foundation - SPF 15,<p>Description</p>,Infinite,"[Face], [Makeup Essentials]",0.2,kg,Color,,164.65,,,https://media.zid.store/img1.jpg
MF10,,Mineral Foundation - SPF 15 - Double Cocoa,<p>Description</p>,Infinite,,0.2,kg,Color,Double Cocoa,164.65,,,https://media.zid.store/img1.jpg
MF02,,Mineral Foundation - SPF 15 - Ivory,<p>Description</p>,0,,0.2,kg,Color,Ivory,164.65,,,https://media.zid.store/img1.jpg
TEP037,No,Everyday Nude 12 color Eyeshadow Palette,Description,Infinite,"[Eyes], [Best Sellers]",0.1,kg,,,219.53,,,https://media.zid.store/img2.jpg
VLC004,No,Kiss Proof Lip Crème - Rose Petal,Description,11,"[Lips]",0.05,kg,,,94.52,,,https://media.zid.store/img3.jpg
`;

describe('parseCatalogCsv', () => {
  it('parses parent-variant products and standalone products', () => {
    const products = parseCatalogCsv(SAMPLE_ZID_CSV);
    expect(products).toHaveLength(3);

    // Product 1: Parent with 2 variants
    const mf = products[0];
    expect(mf.sku).toBe('MF');
    expect(mf.name).toBe('Mineral Foundation - SPF 15');
    expect(mf.has_variants).toBe(true);
    expect(mf.categories).toEqual(['Face', 'Makeup Essentials']);
    expect(mf.variants).toHaveLength(2);
    expect(mf.variants[0]).toEqual({
      label: 'Double Cocoa',
      sku: 'MF10',
      price: 164.65,
      quantity: 'Infinite',
      price_modifier: 0,
    });
    expect(mf.variants[1].quantity).toBe('0');

    // Product 2: Standalone Eyeshadow Palette
    const tep = products[1];
    expect(tep.sku).toBe('TEP037');
    expect(tep.has_variants).toBe(false);
    expect(tep.quantity).toBe('Infinite');
    expect(tep.price).toBe(219.53);

    // Product 3: Standalone Lipstick with stock quantity 11
    const vlc = products[2];
    expect(vlc.sku).toBe('VLC004');
    expect(vlc.quantity).toBe('11');
    expect(vlc.price).toBe(94.52);
  });
});

describe('exportCatalogCsv', () => {
  it('round-trips parsed products back into CSV format', () => {
    const products = parseCatalogCsv(SAMPLE_ZID_CSV);
    const exportedCsv = exportCatalogCsv(products);

    expect(exportedCsv).toContain('MF,Yes,Mineral Foundation - SPF 15');
    expect(exportedCsv).toContain('MF10,');
    expect(exportedCsv).toContain('TEP037,No,Everyday Nude 12 color Eyeshadow Palette');

    const reParsed = parseCatalogCsv(exportedCsv);
    expect(reParsed).toHaveLength(3);
  });
});
