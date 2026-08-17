/**
 * Inventory deduction for confirmed WhatsApp carts.
 *
 * `catalog_products.quantity` is a TEXT column — either a non-negative
 * integer as a string, or a non-numeric sentinel like 'Infinite' (the
 * default) meaning "don't track stock". Deduction only touches products
 * whose quantity parses as an integer; everything else is skipped.
 *
 * Stock floors at 0 — we never go negative, and never block a sale.
 *
 * Call this exactly once per cart, on the transition INTO 'confirmed'
 * (manual confirm route or a 'paid' store webhook). Callers are
 * responsible for the status guard so a duplicate webhook doesn't
 * double-deduct.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface InventoryDeductionResult {
  /** Number of cart line items that had tracked stock adjusted. */
  adjusted: number;
  /** Human-readable notes, e.g. items that hit zero stock. */
  notes: string[];
}

export async function decrementCartInventory(
  db: SupabaseClient,
  cartId: string,
): Promise<InventoryDeductionResult> {
  const result: InventoryDeductionResult = { adjusted: 0, notes: [] };

  const { data: items, error } = await db
    .from('whatsapp_cart_items')
    .select('product_id, product_name, quantity')
    .eq('cart_id', cartId);

  if (error || !items || items.length === 0) return result;

  for (const item of items) {
    if (!item.product_id) continue;

    const { data: product } = await db
      .from('catalog_products')
      .select('id, name, quantity')
      .eq('id', item.product_id)
      .maybeSingle();

    if (!product) continue;

    const current = parseInt(String(product.quantity ?? ''), 10);
    if (!Number.isFinite(current) || current < 0 || String(product.quantity).trim() === '') {
      continue; // 'Infinite' / non-tracked stock
    }

    const next = Math.max(0, current - item.quantity);
    if (next === current) continue;

    const { error: updateErr } = await db
      .from('catalog_products')
      .update({ quantity: String(next) })
      .eq('id', product.id);

    if (updateErr) {
      result.notes.push(`Failed to update stock for ${product.name}`);
      continue;
    }

    result.adjusted += 1;
    if (next === 0) {
      result.notes.push(`${product.name} is now out of stock`);
    }
  }

  return result;
}
