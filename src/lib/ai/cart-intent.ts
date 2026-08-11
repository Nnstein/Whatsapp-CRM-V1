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
        // "add to cart" is ambiguous without knowing WHICH product —
        // hand off to LLM which has the catalog context injected into
        // its system prompt and can resolve "the red one" from context.
        return false;
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

  const currency = (products[0] as any).currency ?? 'SAR';
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

  const message = [
    '🛒 *Order Summary:*',
    lines,
    `\n*Total: ${currency} ${total}*`,
    paymentNote ? `\n💳 *Payment instructions:*\n${paymentNote}` : '',
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
