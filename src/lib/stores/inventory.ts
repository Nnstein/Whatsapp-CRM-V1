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

  // Batch-fetch all referenced products in ONE query instead of one
  // round-trip per line item — a 20-item cart is 2 requests total, not 21.
  const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))];
  if (productIds.length === 0) return result;

  const { data: products } = await db
    .from('catalog_products')
    .select('id, name, quantity')
    .in('id', productIds);

  if (!products || products.length === 0) return result;
  const productById = new Map(products.map((p) => [p.id, p]));

  // Compute the updates first, then fire them in parallel.
  const updates: Array<{ id: string; name: string; next: number }> = [];
  for (const item of items) {
    if (!item.product_id) continue;
    const product = productById.get(item.product_id);
    if (!product) continue;

    const current = parseInt(String(product.quantity ?? ''), 10);
    if (!Number.isFinite(current) || current < 0 || String(product.quantity).trim() === '') {
      continue; // 'Infinite' / non-tracked stock
    }

    // Two lines referencing the same product accumulate against the
    // already-computed pending value, not the stale DB value.
    const pending = updates.find((u) => u.id === product.id);
    const base = pending ? pending.next : current;
    const next = Math.max(0, base - item.quantity);

    if (pending) {
      pending.next = next;
    } else if (next !== current) {
      updates.push({ id: product.id, name: product.name, next });
    }
  }

  await Promise.all(
    updates.map(async (u) => {
      const { error: updateErr } = await db
        .from('catalog_products')
        .update({ quantity: String(u.next) })
        .eq('id', u.id);

      if (updateErr) {
        result.notes.push(`Failed to update stock for ${u.name}`);
        return;
      }
      result.adjusted += 1;
      if (u.next === 0) {
        result.notes.push(`${u.name} is now out of stock`);
      }
    }),
  );

  return result;
}
