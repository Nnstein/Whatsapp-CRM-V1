/**
 * Product mention extractor for AI auto-replies.
 *
 * Scans generated AI text responses for product names from the account's
 * active catalog. Matches both exact name occurrences, bolded names
 * (e.g. `*Foundation Stick*`), and high-confidence normalized token matches.
 */

export interface ProductRef {
  id: string;
  name: string;
  price: number;
  currency?: string;
  description?: string | null;
  variants?: any;
}

function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Latin diacritics
    .replace(/[\u064b-\u065f]/g, '') // Arabic harakat
    .toLowerCase()
    .trim();
}

/**
 * Extract matched products from an AI response text.
 *
 * @param text The AI's generated reply text.
 * @param products The list of active catalog products for the account.
 * @returns An array of matched ProductRef objects (deduped, max 30).
 */
export function extractProductMentions(
  text: string,
  products: ProductRef[]
): ProductRef[] {
  if (!text || !products || products.length === 0) return [];

  const matched: ProductRef[] = [];
  const seenIds = new Set<string>();

  // 1. Extract bolded phrases like `*Product Name*`
  const boldMatches = Array.from(text.matchAll(/\*([^*]+)\*/g)).map((m) => m[1].trim());

  for (const boldText of boldMatches) {
    const normBold = normalise(boldText);
    if (!normBold) continue;

    for (const p of products) {
      if (seenIds.has(p.id)) continue;
      const normName = normalise(p.name);
      if (normName === normBold || normName.includes(normBold) || normBold.includes(normName)) {
        seenIds.add(p.id);
        matched.push(p);
      }
    }
  }

  // 2. Direct substring search for complete product names in the text
  const normText = normalise(text);
  for (const p of products) {
    if (seenIds.has(p.id)) continue;
    const normName = normalise(p.name);
    // Ignore short generic words (< 3 chars) to prevent false positives
    if (normName.length < 3) continue;

    // Word boundary or containment
    if (normText.includes(normName)) {
      seenIds.add(p.id);
      matched.push(p);
    }
  }

  // Cap at 30 items per WhatsApp product list limit
  return matched.slice(0, 30);
}
