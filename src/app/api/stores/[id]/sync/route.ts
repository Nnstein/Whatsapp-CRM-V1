import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { syncStoreCatalog } from '@/lib/stores/product-sync';

/**
 * POST /api/stores/[id]/sync
 *
 * Trigger an on-demand catalog product sync from a connected store.
 * Admin+ required.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: storeConnectionId } = await context.params;
    const { supabase, accountId, userId } = await requireRole('admin');

    const rl = checkRateLimit(`sync:${userId}`, RATE_LIMITS.adminAction);
    if (!rl.success) return rateLimitResponse(rl);

    const result = await syncStoreCatalog(supabase, accountId, storeConnectionId);

    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Catalog sync failed' }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      synced_count: result.syncedCount,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
