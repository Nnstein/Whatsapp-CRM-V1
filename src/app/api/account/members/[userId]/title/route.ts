// ============================================================
// /api/account/members/[userId]/title
//
//   PATCH — set (or clear) a member's title. Admin+.
//
// Delegates to the set_member_title SECURITY DEFINER RPC from
// migration 039, which re-verifies caller rank and same-account
// membership. The TS layer forwards the call and maps Postgres
// SQLSTATEs back to HTTP statuses (same contract as the sibling
// role/remove route):
//   42501 → 403, 22023 → 400
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { MAX_MEMBER_TITLE_LENGTH } from '@/lib/presets';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:memberTitle:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as {
      title?: unknown;
    } | null;

    // null clears the title; a string sets it. Anything else is a 400.
    const title = body?.title ?? null;
    if (title !== null && typeof title !== 'string') {
      return NextResponse.json(
        { error: "'title' must be a string or null" },
        { status: 400 },
      );
    }
    if (typeof title === 'string' && title.trim().length > MAX_MEMBER_TITLE_LENGTH) {
      return NextResponse.json(
        { error: `Title must be ${MAX_MEMBER_TITLE_LENGTH} characters or fewer` },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.rpc('set_member_title', {
      p_user_id: userId,
      p_title: title,
    });

    if (error) {
      if (error.code === '42501') {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.code === '22023') {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      console.error('[members title PATCH] unexpected RPC error:', error);
      return NextResponse.json(
        { error: 'Failed to update member title' },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
