// ============================================================
// /api/account/inbox-groups/[id] — DELETE a custom inbox group.
// Admin+.
//
// Vocabulary rows are suggestions only: removing one does NOT
// ungroup numbers that already carry the label
// (whatsapp_config.inbox_group is free text).
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:inboxGroups:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    // account_id filter is belt-and-braces — RLS scopes the delete
    // to the caller's account anyway.
    const { error } = await ctx.supabase
      .from('inbox_groups')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[DELETE /api/account/inbox-groups/[id]] error:', error);
      return NextResponse.json(
        { error: 'Failed to delete custom group' },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
