// ============================================================
// WhatsApp Cart Intent Classifier
//
// A lightweight, keyword-based intent detector that runs BEFORE
// the LLM on every inbound message. When it recognises a cart
// command (browse, add, view, checkout, clear) it handles the
// request deterministically — no LLM call, no API key required.
//
// Falls through (returns null) when no intent is matched, letting
// dispatchInboundToAiReply take over for everything else.
//
// Supports Arabic (Gulf), Hindi, and English patterns so the cart
// works naturally for the target MENA user base.
//
// All heavy I/O (Supabase reads, WhatsApp sends) happens inside the
// handler functions. The classifier itself is pure + testable.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { engineSendText } from '@/lib/flows/meta-send';
import { getStoreCheckoutUrl } from '@/lib/stores/checkout-url';
import { getPaymentLink } from '@/lib/payments/payment-link';

// ────────────────────────────────────────────────────────────
// Intent patterns
// ────────────────────────────────────────────────────────────

export type CartIntent =
  | 'browse_catalog'   // "show me your products"
  | 'add_to_cart'      // "add that" / "I want the blue one"
  | 'view_cart'        // "my cart" / "what's in my cart"
  | 'checkout'         // "checkout" / "pay now"
  | 'clear_cart'       // "clear my cart" / "cancel order"
  | null;              // no cart intent detected

const BROWSE_PATTERNS = [
  // English
  /\bshow\s+me\b/i,
  /\bwhat\s+do\s+you\s+(have|sell|offer)\b/i,
  /\byour\s+(products?|items?|catalog|menu|catalogue)\b/i,
  /\bproducts?\b/i,
  /\bwhat('?s|\s+is)\s+available\b/i,
  /\blist\s+(your\s+)?products?\b/i,
  // Arabic
  /أرني|أعرض|عندك|عندكم|ش(عندكم|عندك)|شو عندك|ايش عندك|اعرض/u,
  /المنتجات|منتجاتك|منتجات|بضاعة|الكتالوج|قائمة/u,
  /وش عندكم|شوفني/u,
  // Hindi
  /\bدکھاو\b|\bکیا\s+ہے\b/u,
  /\bkya\s+(hai|he|aap\s+k?ar)\b/i,
  /\bdikh?ao?\b/i,
  /\bproduct\s+dikhao\b/i,
];

const ADD_TO_CART_PATTERNS = [
  // English
  /\b(add|put)\s+(that|this|it|one|to\s+(my\s+)?cart)\b/i,
  /\bi\s+want\s+(that|this|one|the)\b/i,
  /\bi('ll)?\s+take\s+(that|this|one|the)\b/i,
  /\border\s+(that|this|one)\b/i,
  // Arabic
  /أضف|ضيف|أبغى|بغيت|أريد|بدي|خذ لي|ودي|حاطه|أخذ/u,
  /اضف|ضف\s+هذا|خل|أخذ\s+هذا|ابي\s+هذا/u,
  // Hindi
  /\b(add\s+kar|chahiye|chahta|chahti|lena\s+hai)\b/i,
  /\blo\s+(yeh|voh|woh|ek)\b/i,
];

const VIEW_CART_PATTERNS = [
  // English
  /\bmy\s+cart\b/i,
  /\bwhat('s|\s+is)\s+in\s+(my\s+)?cart\b/i,
  /\bview\s+(my\s+)?cart\b/i,
  /\bshow\s+(my\s+)?cart\b/i,
  /\bcart\s+summary\b/i,
  /\border\s+summary\b/i,
  // Arabic
  /سلتي|سلة\s+التسوق|طلبيتي|ايش\s+في\s+سلتي|ايش\s+طلبت/u,
  /شوف\s+طلبي|الطلب/u,
  // Hindi
  /\bm?era\s+cart\b/i,
  /\bcart\s+d[ei]kh?ao?\b/i,
];

const CHECKOUT_PATTERNS = [
  // English
  /\bcheck\s*out\b/i,
  /\bpay\s+(now|for\s+this)?\b/i,
  /\bi('m|\s+am)\s+(done|ready\s+to\s+(pay|buy|order))\b/i,
  /\bfinish\s+(my\s+)?order\b/i,
  /\bplace\s+(my\s+)?order\b/i,
  /\bconfirm\s+(my\s+)?order\b/i,
  /\bthat('s|\s+is)\s+all\b/i,
  // Arabic
  /ادفع|دفع|الدفع|خلص|أنهي|إتمام|تسليم|أكمل\s+الطلب/u,
  /خلصت|انتهيت|أبغى\s+أدفع|ابي\s+ادفع/u,
  /إتمام\s+الشراء|إنهاء\s+الطلب|الطلب\s+جاهز/u,
  // Hindi
  /\b(checkout|payment|pay|order)\s+(kar[oa]?|karo)\b/i,
  /\bkhatam\s+(hai|hua)\b/i,
];

const CLEAR_CART_PATTERNS = [
  // English
  /\bclear\s+(my\s+)?cart\b/i,
  /\bcancel\s+(my\s+)?(order|cart)\b/i,
  /\bremove\s+all\b/i,
  /\bstart\s+over\b/i,
  /\bempty\s+(my\s+)?cart\b/i,
  // Arabic
  /امسح\s+(السلة|طلبي)|إلغاء\s+الطلب|مسح\s+الطلب|إلغ/u,
  /ألغِ\s+طلبي|لا\s+أريد/u,
  // Hindi
  /\bcancel\s+karo?\b/i,
  /\bsab\s+hata\s+do?\b/i,
];

/**
 * Classify the inbound message text into a cart intent (or null).
 * Order matters: more specific patterns are checked first.
 */
export function classifyCartIntent(text: string): CartIntent {
  if (!text?.trim()) return null;

  // clear_cart before add_to_cart to avoid "I want to cancel" matching add
  for (const p of CLEAR_CART_PATTERNS)  if (p.test(text)) return 'clear_cart';
  for (const p of CHECKOUT_PATTERNS)    if (p.test(text)) return 'checkout';
  for (const p of VIEW_CART_PATTERNS)   if (p.test(text)) return 'view_cart';
  for (const p of BROWSE_PATTERNS)      if (p.test(text)) return 'browse_catalog';
  for (const p of ADD_TO_CART_PATTERNS) if (p.test(text)) return 'add_to_cart';

  return null;
}

// ────────────────────────────────────────────────────────────
// Pure helpers (exported for unit testing)
// ────────────────────────────────────────────────────────────

/**
 * Strip diacritics and normalise text for fuzzy matching.
 * Handles Latin diacritics and Arabic harakat.
 */
function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // Latin diacritics
    .replace(/[\u064b-\u065f]/g, '')  // Arabic harakat
    .toLowerCase()
    .trim();
}

/** Intent-prefix stripping — remove "I want / أبغى / أريد / …" before product name */
const STRIP_PREFIXES = [
  /^i\s*(want|('ll\s*)?take|need|('d\s*)?like)\s+(the\s+|a\s+|an\s+)?/i,
  /^(add|put)\s+(the\s+|a\s+|an\s+)?/i,
  /^(order|buy|get\s+me)\s+(the\s+|a\s+|an\s+)?/i,
  /^(أبغى|أريد|بدي|ابي|بغيت|اريد)\s*/u,
  /^(أضف|ضيف|اضف|خذ\s*لي)\s*/u,
  /^(chahiye|chahta|chahti|lena\s+hai)\s*/i,
];

/**
 * Try to extract the product hint from the message by stripping intent
 * prefixes. Falls back to the full message when nothing is stripped.
 */
export function extractProductHint(text: string): string {
  let s = text.trim();
  for (const p of STRIP_PREFIXES) {
    const stripped = s.replace(p, '').trim();
    if (stripped && stripped !== s) { s = stripped; break; }
  }
  return s;
}

export interface CatalogProductRef {
  id: string;
  name: string;
  price: number;
  variants?: Array<{ label?: string }>;
  description?: string | null;
}

/**
 * Resolve which product the customer is referring to.
 *
 * Resolution order:
 *  1. Catalog number ("product 2", "رقم ٢", plain digit "3")
 *  2. Exact product name match (case-insensitive, diacritic-insensitive)
 *  3. Fuzzy: score = fraction of hint tokens found in product name; ≥ 0.5 wins
 *
 * When lastShownProducts is provided, catalog number resolution uses that
 * ordered list (matching what the customer saw in the browse reply).
 *
 * Returns `{ product, variantHint }` or `null` when nothing is confident.
 */
export function resolveProductFromMessage(
  text: string,
  products: CatalogProductRef[],
  lastShownProducts?: CatalogProductRef[],
): { product: CatalogProductRef; variantHint: string } | null {
  if (!products.length) return null;

  const hint = extractProductHint(text);
  const normHint = normalise(hint);

  // ── 1. Catalog number resolution ──
  // Matches: "product 2", "item 3", "number 2", "رقم 2", "#3", or plain "2"
  const pool = lastShownProducts && lastShownProducts.length > 0 ? lastShownProducts : products;
  const numMatch = normHint.match(
    /(?:product|item|number|رقم|#|no\.?)\s*([١-٩\d]+)|^([١-٩\d]+)$/
  );
  if (numMatch) {
    // Convert Arabic-Indic digits to ASCII
    const raw = (numMatch[1] || numMatch[2])
      .split('').map(c => {
        const idx = '١٢٣٤٥٦٧٨٩'.indexOf(c);
        return idx >= 0 ? String(idx + 1) : c;
      }).join('');
    const idx = parseInt(raw, 10) - 1;
    if (idx >= 0 && idx < pool.length) {
      return { product: pool[idx], variantHint: '' };
    }
  }

  // ── 2 & 3. Name matching ──
  let best: CatalogProductRef | null = null;
  let bestScore = 0;
  const hintTokens = normHint.split(/\s+/).filter(Boolean);

  for (const p of products) {
    const normName = normalise(p.name);

    // Exact / substring match
    if (normName === normHint || normName.includes(normHint)) {
      return { product: p, variantHint: extractVariantHint(text, p) };
    }

    // Fuzzy: fraction of hint tokens present in the product name
    if (hintTokens.length === 0) continue;
    const matched = hintTokens.filter(t => normName.includes(t)).length;
    const score = matched / hintTokens.length;
    if (score > bestScore) { bestScore = score; best = p; }
  }

  if (best && bestScore >= 0.5) {
    return { product: best, variantHint: extractVariantHint(text, best) };
  }
  return null;
}

/**
 * Parse an explicit quantity from the message ("2 of", "two", "×3").
 * Defaults to 1 when no quantity is found or it's out of range.
 */
export function parseQuantity(text: string): number {
  const wordMap: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };

  // Numeric: "2 of", "order 3", "× 2", "x2", Arabic-Indic digits
  const numRe = /(?:^|\s)([١-٩\d]+)\s*(?:of|x|×|عدد|قطعة|قطع)?/i;
  const m = text.match(numRe);
  if (m) {
    const raw = m[1].split('').map(c => {
      const idx = '١٢٣٤٥٦٧٨٩'.indexOf(c);
      return idx >= 0 ? String(idx + 1) : c;
    }).join('');
    const v = parseInt(raw, 10);
    if (v > 0 && v <= 100) return v;
  }

  // Written-out word numbers
  for (const [word, n] of Object.entries(wordMap)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) return n;
  }
  return 1;
}

/**
 * Extract a variant hint from the message given a product with variants.
 * Compares diacritic-stripped, lowercased text against each variant label.
 */
export function extractVariantHint(text: string, product: CatalogProductRef): string {
  if (!product.variants || product.variants.length === 0) return '';
  const normText = normalise(text);
  for (const v of product.variants) {
    if (!v.label) continue;
    if (normText.includes(normalise(v.label))) return v.label;
  }
  return '';
}

// ────────────────────────────────────────────────────────────
// Handler dispatch
// ────────────────────────────────────────────────────────────

export interface CartIntentArgs {
  accountId: string;
  contactId: string;
  conversationId: string;
  configOwnerUserId: string;
  inboundText: string;
}

/**
 * Entry point called by the webhook handler after Flows decide not to
 * consume a message. Returns true if a cart intent was handled
 * (callers should not also dispatch the LLM), false otherwise.
 *
 * Never throws — all errors are caught and logged.
 */
export async function dispatchCartIntent(args: CartIntentArgs): Promise<boolean> {
  const intent = classifyCartIntent(args.inboundText);
  if (!intent) return false;

  const db = supabaseAdmin();
  try {
    switch (intent) {
      case 'browse_catalog':
        await handleBrowseCatalog(db, args);
        return true;
      case 'view_cart':
        await handleViewCart(db, args);
        return true;
      case 'checkout':
        await handleCheckout(db, args);
        return true;
      case 'clear_cart':
        await handleClearCart(db, args);
        return true;
      case 'add_to_cart':
        await handleAddToCart(db, args);
        return true;
      default:
        return false;
    }
  } catch (err) {
    console.error('[cart-intent] dispatch failed:', err);
    return false;
  }
}

// ────────────────────────────────────────────────────────────
// Individual intent handlers
// ────────────────────────────────────────────────────────────

async function send(db: SupabaseClient, args: CartIntentArgs, text: string) {
  await engineSendText({
    accountId: args.accountId,
    userId: args.configOwnerUserId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    text,
  });
}

async function handleBrowseCatalog(db: SupabaseClient, args: CartIntentArgs) {
  const { data: products } = await db
    .from('catalog_products')
    .select('id, name, description, price, currency, variants')
    .eq('account_id', args.accountId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(10);

  if (!products || products.length === 0) {
    await send(db, args,
      "We don't have a product catalog set up yet. " +
      "Please contact us directly to learn about our products! 🙏"
    );
    return;
  }

  // Use workspace default currency rather than per-product currency
  const { data: accountRow } = await db
    .from('accounts')
    .select('default_currency')
    .eq('id', args.accountId)
    .maybeSingle();
  const currency = (accountRow as any)?.default_currency ?? (products[0] as any).currency ?? 'SAR';

  const lines = products.map((p: any, i: number) => {
    const price = `${currency} ${Number(p.price).toFixed(2)}`;
    const variants = Array.isArray(p.variants) && p.variants.length > 0
      ? ` — variants: ${(p.variants as Array<{label?: string}>).map(v => v.label ?? '').filter(Boolean).join(', ')}`
      : '';
    return `*${i + 1}. ${p.name}* — ${price}${variants}${p.description ? `\n   ${p.description}` : ''}`;
  }).join('\n\n');

  const footer = products.length === 10 ? '\n\n_Showing top 10 products._' : '';
  await send(db, args,
    `🛍️ *Our Products*\n\n${lines}${footer}\n\nReply with the product name or number to add it to your cart!`
  );

  // Persist the shown order so "I want number 2" resolves correctly on follow-up.
  const productIds = products.map((p: any) => p.id);
  await db
    .from('conversations')
    .update({ last_catalog_product_ids: productIds })
    .eq('id', args.conversationId);
}

async function handleAddToCart(db: SupabaseClient, args: CartIntentArgs) {
  // Load all active products for this account (up to 50)
  const { data: rawProducts } = await db
    .from('catalog_products')
    .select('id, name, description, price, variants')
    .eq('account_id', args.accountId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(50);

  const products: CatalogProductRef[] = (rawProducts ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    variants: Array.isArray(p.variants) ? p.variants : [],
    description: p.description ?? null,
  }));

  if (products.length === 0) {
    await send(db, args,
      "We don't have any products available right now. Please contact us directly! 🙏"
    );
    return;
  }

  // Fetch the last-shown product list from this conversation (for number resolution)
  const { data: convRow } = await db
    .from('conversations')
    .select('last_catalog_product_ids')
    .eq('id', args.conversationId)
    .maybeSingle();

  const lastShownIds: string[] = Array.isArray((convRow as any)?.last_catalog_product_ids)
    ? (convRow as any).last_catalog_product_ids
    : [];
  const lastShownProducts: CatalogProductRef[] = lastShownIds
    .map(id => products.find(p => p.id === id))
    .filter((p): p is CatalogProductRef => p !== undefined);

  // Resolve which product the customer is asking for
  const resolved = resolveProductFromMessage(args.inboundText, products, lastShownProducts);

  if (!resolved) {
    // No confident match — ask for clarification with the top-5 products
    const top5 = products.slice(0, 5).map((p, i) =>
      `*${i + 1}.* ${p.name} — ${Number(p.price).toFixed(2)}`
    ).join('\n');
    await send(db, args,
      `I didn't quite catch which product you'd like! 🤔\n\nHere are our top products:\n${top5}\n\nReply with the product name or number to add it to your cart!`
    );
    return;
  }

  const { product, variantHint } = resolved;
  const quantity = parseQuantity(args.inboundText);

  // If the product has variants but none was specified, ask which one
  const productVariants = (product.variants ?? []).filter((v: any) => v.label);
  if (productVariants.length > 0 && !variantHint) {
    const variantList = productVariants.map((v: any) => `• ${v.label}`).join('\n');
    await send(db, args,
      `Which variant of *${product.name}* would you like? 🎨\n\n${variantList}\n\nReply with the variant name to add it to your cart!`
    );
    return;
  }

  // Fetch workspace currency
  const { data: accountRow } = await db
    .from('accounts')
    .select('default_currency')
    .eq('id', args.accountId)
    .maybeSingle();
  const currency = (accountRow as any)?.default_currency ?? 'SAR';

  // Get or create the open cart for this contact
  let cartId: string;
  const { data: existingCart } = await db
    .from('whatsapp_carts')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('status', 'open')
    .maybeSingle();

  if (existingCart) {
    cartId = existingCart.id;
  } else {
    const { data: newCart, error: cartErr } = await db
      .from('whatsapp_carts')
      .insert({
        account_id: args.accountId,
        contact_id: args.contactId,
        conversation_id: args.conversationId,
        status: 'open',
      })
      .select('id')
      .single();

    if (cartErr || !newCart) {
      console.error('[cart-intent] failed to create cart:', cartErr);
      await send(db, args, "Sorry, I couldn't add that to your cart right now. Please try again! 🙏");
      return;
    }
    cartId = newCart.id;
  }

  // Upsert: merge quantity if the same product+variant is already in the cart
  const resolvedVariantLabel = variantHint || null;
  const { data: existingItem } = await db
    .from('whatsapp_cart_items')
    .select('id, quantity')
    .eq('cart_id', cartId)
    .eq('product_id', product.id)
    .eq('variant_label', resolvedVariantLabel ?? '')
    .maybeSingle();

  if (existingItem) {
    await db
      .from('whatsapp_cart_items')
      .update({ quantity: existingItem.quantity + quantity })
      .eq('id', existingItem.id);
  } else {
    const { error: itemErr } = await db
      .from('whatsapp_cart_items')
      .insert({
        cart_id: cartId,
        product_id: product.id,
        product_name: product.name,
        product_price: product.price,
        variant_label: resolvedVariantLabel,
        quantity,
      });

    if (itemErr) {
      console.error('[cart-intent] failed to insert cart item:', itemErr);
      await send(db, args, "Sorry, I couldn't add that to your cart. Please try again! 🙏");
      return;
    }
  }

  // Confirm to the customer
  const variantSuffix = resolvedVariantLabel ? ` (${resolvedVariantLabel})` : '';
  const qtyLabel = quantity > 1 ? ` × ${quantity}` : '';
  const subtotal = `${currency} ${(product.price * quantity).toFixed(2)}`;

  await send(db, args,
    `✅ Added *${product.name}${variantSuffix}*${qtyLabel} to your cart! (${subtotal})\n\nReply *"my cart"* to review your order or *"checkout"* when ready to pay. 🛒`
  );
}

async function handleViewCart(db: SupabaseClient, args: CartIntentArgs) {
  const { data: cart } = await db
    .from('whatsapp_carts')
    .select(`
      id, status,
      items:whatsapp_cart_items(product_name, product_price, variant_label, quantity)
    `)
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('status', 'open')
    .maybeSingle();

  if (!cart) {
    await send(db, args, "Your cart is empty. 🛒 Reply with a product name to start shopping!");
    return;
  }

  const items = (cart.items ?? []) as Array<{
    product_name: string;
    product_price: number;
    variant_label: string | null;
    quantity: number;
  }>;

  if (items.length === 0) {
    await send(db, args, "Your cart is empty. 🛒 Reply with a product name to start shopping!");
    return;
  }

  const lines = items.map(item => {
    const variant = item.variant_label ? ` (${item.variant_label})` : '';
    const subtotal = (item.product_price * item.quantity).toFixed(2);
    return `• ${item.product_name}${variant} × ${item.quantity} — ${subtotal}`;
  }).join('\n');

  const total = items.reduce((s, item) => s + item.product_price * item.quantity, 0).toFixed(2);
  await send(db, args, `🛒 *Your cart:*\n\n${lines}\n\n*Total: ${total}*\n\nReply "checkout" when ready to pay! ✅`);
}

async function handleCheckout(db: SupabaseClient, args: CartIntentArgs) {
  const { data: cart } = await db
    .from('whatsapp_carts')
    .select(`
      id, status,
      items:whatsapp_cart_items(product_name, product_price, variant_label, quantity)
    `)
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('status', 'open')
    .maybeSingle();

  if (!cart) {
    await send(db, args, "You don't have any items in your cart yet. 🛒 Let me know what you'd like to order!");
    return;
  }

  const items = (cart.items ?? []) as Array<{
    product_name: string;
    product_price: number;
    variant_label: string | null;
    quantity: number;
  }>;

  if (items.length === 0) {
    await send(db, args, "Your cart is empty — add something first!");
    return;
  }

  // Fetch account payment instructions.
  const { data: accountRow } = await db
    .from('accounts')
    .select('payment_instructions, default_currency')
    .eq('id', args.accountId)
    .maybeSingle();

  const currency = (accountRow as any)?.default_currency ?? 'SAR';
  const paymentNote = (accountRow as any)?.payment_instructions?.trim() ?? '';

  const lines = items.map(item => {
    const variant = item.variant_label ? ` (${item.variant_label})` : '';
    const subtotal = (item.product_price * item.quantity).toFixed(2);
    return `• ${item.product_name}${variant} × ${item.quantity} — ${currency} ${subtotal}`;
  }).join('\n');

  const total = items.reduce((s, item) => s + item.product_price * item.quantity, 0).toFixed(2);

  // Load contact info for customer name / phone on payment gateway.
  const { data: contact } = await db
    .from('contacts')
    .select('id, name, phone, email')
    .eq('id', args.contactId)
    .maybeSingle();

  // 1. In-chat payment gateway link (MyFatoorah, Hesabe, etc.)
  const paymentLink = await getPaymentLink(
    db,
    args.accountId,
    { items, total: parseFloat(total), currency },
    cart.id,
    contact ?? { id: args.contactId },
    args.conversationId,
  );

  // 2. Store checkout URL fallback if no payment link
  const checkout = !paymentLink
    ? await getStoreCheckoutUrl(db, args.accountId, {
        items,
        total: parseFloat(total),
        currency,
      })
    : null;

  const payUrl = paymentLink?.url ?? checkout?.url ?? null;

  const message = [
    '🛒 *Order Summary:*',
    lines,
    `\n*Total: ${currency} ${total}*`,
    payUrl ? `\n🔗 *Pay securely online:*\n${payUrl}` : '',
    !payUrl && paymentNote ? `\n💳 *Payment instructions:*\n${paymentNote}` : '',
    "\nThank you! We'll confirm your order once payment is received. 🙏",
  ].filter(Boolean).join('\n');

  await send(db, args, message);

  // Mark cart as checkout_sent.
  await db
    .from('whatsapp_carts')
    .update({
      status: 'checkout_sent',
      checkout_note: paymentNote || null,
      conversation_id: args.conversationId,
      store_checkout_url: payUrl,
      store_connection_id: checkout?.connectionId ?? null,
    })
    .eq('id', cart.id);
}

async function handleClearCart(db: SupabaseClient, args: CartIntentArgs) {
  const { data: cart } = await db
    .from('whatsapp_carts')
    .select('id, status')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('status', 'open')
    .maybeSingle();

  if (!cart) {
    await send(db, args, "You don't have an open cart to clear. 🛒");
    return;
  }

  // Mark cancelled (don't hard-delete for audit trail).
  await db
    .from('whatsapp_carts')
    .update({ status: 'cancelled' })
    .eq('id', cart.id);

  await send(db, args, "Your cart has been cleared. 🗑️ Let me know if you'd like to start a new order!");
}
