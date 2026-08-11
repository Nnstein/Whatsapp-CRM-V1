/**
 * Catalog CSV Parser & Exporter Utility
 *
 * Fully compatible with the Zid CSV product structure:
 * sku, has_variants, name_en, description_en, quantity, categories_en,
 * weight, weight_unit, option1_name_en, option1_value_en, option2_name_en,
 * option2_value_en, option3_name_en, option3_value_en, price, sale_price, cost, images
 */

export interface ParsedCsvProduct {
  sku: string | null;
  name: string;
  description: string | null;
  price: number;
  sale_price?: number | null;
  cost?: number | null;
  currency?: string;
  quantity: string;
  categories: string[];
  image_url: string | null;
  images: string[];
  weight: number;
  weight_unit: string;
  has_variants: boolean;
  variants: Array<{
    label: string;
    sku?: string;
    price?: number;
    quantity?: string;
    price_modifier?: number;
  }>;
  tags: string[];
}

/** Helper to parse a single CSV line accounting for quoted cells */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/** Parses categories string e.g. "[Face], [Makeup Essentials]" -> ["Face", "Makeup Essentials"] */
function parseCategories(raw: string): string[] {
  if (!raw) return [];
  const matches = raw.match(/\[(.*?)\]/g);
  if (matches && matches.length > 0) {
    return matches.map((m) => m.replace(/^\[|\]$/g, '').trim()).filter(Boolean);
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Parses images string e.g. "https://url1, https://url2" or single URL */
function parseImages(raw: string): string[] {
  if (!raw || raw.toLowerCase() === 'none') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('http://') || s.startsWith('https://'));
}

/**
 * Parses raw CSV content into structured product objects.
 * Handles Zid format parent rows (has_variants=Yes) and child variant rows.
 */
export function parseCatalogCsv(csvContent: string): ParsedCsvProduct[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const rawHeaders = parseCsvLine(lines[0]);
  const headers = rawHeaders.map((h) => h.toLowerCase().replace(/["']/g, ''));

  const getCol = (row: string[], name: string): string => {
    const idx = headers.findIndex((h) => h === name || h.startsWith(name));
    return idx !== -1 && row[idx] ? row[idx] : '';
  };

  const products: ParsedCsvProduct[] = [];
  let currentParent: ParsedCsvProduct | null = null;

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (row.length === 0 || row.every((c) => !c)) continue;

    const sku = getCol(row, 'sku') || null;
    const hasVariantsRaw = (getCol(row, 'has_variant') || getCol(row, 'has_variants')).toLowerCase().trim();
    const hasVariants = ['yes', 'true', '1'].includes(hasVariantsRaw);
    const isExplicitStandalone = ['no', 'false', '0'].includes(hasVariantsRaw);

    const name =
      getCol(row, 'name_en') ||
      getCol(row, 'name') ||
      getCol(row, 'name_ar') ||
      `Product ${sku || i}`;

    const description =
      getCol(row, 'description_en') ||
      getCol(row, 'description') ||
      getCol(row, 'description_ar') ||
      null;

    const quantityRaw = getCol(row, 'quantity');
    const quantity = quantityRaw ? quantityRaw : 'Infinite';

    const priceRaw = getCol(row, 'price');
    const price = parseFloat(priceRaw) || 0;

    const salePriceRaw = getCol(row, 'sale_price');
    const salePrice = salePriceRaw ? parseFloat(salePriceRaw) : null;

    const costRaw = getCol(row, 'cost');
    const cost = costRaw ? parseFloat(costRaw) : null;

    const categoriesRaw = getCol(row, 'categories_en') || getCol(row, 'categories');
    const categories = parseCategories(categoriesRaw);

    const weightRaw = getCol(row, 'weight');
    const weight = parseFloat(weightRaw) || 0;
    const weightUnit = getCol(row, 'weight_unit') || 'kg';

    const imagesRaw = getCol(row, 'images');
    const images = parseImages(imagesRaw);
    const mainImageUrl = images.length > 0 ? images[0] : null;

    const option1Name = getCol(row, 'option1_name_en') || getCol(row, 'option1_name');
    const option1Val = getCol(row, 'option1_value_en') || getCol(row, 'option1_value');

    // Case 1: Parent Product Row (has_variants = Yes)
    if (hasVariants) {
      currentParent = {
        sku,
        name,
        description,
        price,
        sale_price: salePrice,
        cost,
        quantity,
        categories,
        image_url: mainImageUrl,
        images,
        weight,
        weight_unit: weightUnit,
        has_variants: true,
        variants: [],
        tags: categories,
      };
      products.push(currentParent);
      continue;
    }

    // Case 2: Child Variant Row belonging to active parent (has_variants is blank/empty)
    if (currentParent && !isExplicitStandalone && (option1Val || hasVariantsRaw === '')) {
      const variantLabel = option1Val || name.replace(currentParent.name, '').replace(/^-|^\s+-\s+/, '').trim() || name;
      currentParent.variants.push({
        label: variantLabel,
        sku: sku || undefined,
        price: price > 0 ? price : currentParent.price,
        quantity,
        price_modifier: price > 0 ? price - currentParent.price : 0,
      });
      if (images.length > 0) {
        images.forEach((img) => {
          if (!currentParent!.images.includes(img)) {
            currentParent!.images.push(img);
          }
        });
      }
      continue;
    }

    // Case 3: Standalone Product (has_variants = No or new product)
    currentParent = null;
    products.push({
      sku,
      name,
      description,
      price,
      sale_price: salePrice,
      cost,
      quantity,
      categories,
      image_url: mainImageUrl,
      images,
      weight,
      weight_unit: weightUnit,
      has_variants: false,
      variants: option1Val
        ? [{ label: option1Val, sku: sku || undefined, price, quantity, price_modifier: 0 }]
        : [],
      tags: categories,
    });
  }

  return products;
}

/**
 * Serializes catalog products into CSV text format (Zid compatible).
 */
export function exportCatalogCsv(products: ParsedCsvProduct[]): string {
  const headers = [
    'sku',
    'has_variants',
    'name_en',
    'description_en',
    'quantity',
    'categories_en',
    'weight',
    'weight_unit',
    'option1_name_en',
    'option1_value_en',
    'price',
    'sale_price',
    'cost',
    'images',
  ];

  const lines: string[] = [headers.join(',')];

  const escapeCsv = (str: string | number | null | undefined): string => {
    if (str == null) return '';
    const clean = String(str).replace(/"/g, '""');
    return clean.includes(',') || clean.includes('\n') || clean.includes('"')
      ? `"${clean}"`
      : clean;
  };

  for (const p of products) {
    const formattedCategories = p.categories && p.categories.length > 0
      ? p.categories.map((c) => `[${c}]`).join(', ')
      : '';
    const formattedImages = p.images && p.images.length > 0 ? p.images.join(', ') : p.image_url || '';

    if (p.has_variants && p.variants.length > 0) {
      // Parent row
      lines.push(
        [
          escapeCsv(p.sku),
          'Yes',
          escapeCsv(p.name),
          escapeCsv(p.description),
          escapeCsv(p.quantity),
          escapeCsv(formattedCategories),
          escapeCsv(p.weight),
          escapeCsv(p.weight_unit),
          'Option',
          '',
          escapeCsv(p.price),
          escapeCsv(p.sale_price),
          escapeCsv(p.cost),
          escapeCsv(formattedImages),
        ].join(',')
      );

      // Child variant rows
      for (const v of p.variants) {
        lines.push(
          [
            escapeCsv(v.sku || p.sku),
            '',
            escapeCsv(`${p.name} - ${v.label}`),
            escapeCsv(p.description),
            escapeCsv(v.quantity || p.quantity),
            '',
            escapeCsv(p.weight),
            escapeCsv(p.weight_unit),
            '',
            escapeCsv(v.label),
            escapeCsv(v.price || p.price),
            escapeCsv(p.sale_price),
            escapeCsv(p.cost),
            escapeCsv(formattedImages),
          ].join(',')
        );
      }
    } else {
      // Standalone row
      lines.push(
        [
          escapeCsv(p.sku),
          'No',
          escapeCsv(p.name),
          escapeCsv(p.description),
          escapeCsv(p.quantity),
          escapeCsv(formattedCategories),
          escapeCsv(p.weight),
          escapeCsv(p.weight_unit),
          '',
          '',
          escapeCsv(p.price),
          escapeCsv(p.sale_price),
          escapeCsv(p.cost),
          escapeCsv(formattedImages),
        ].join(',')
      );
    }
  }

  return lines.join('\n');
}
