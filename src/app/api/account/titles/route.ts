// ============================================================
// /api/account/titles — member-title vocabulary (migration 039)
//
//   GET  — any member. Returns the generic preset list plus the
//          account's custom titles (pickers merge the two).
//   POST — admin+. Adds a custom title to the account vocabulary.
//
// Titles themselves live as free text on profiles.title; this table
// is only a curated suggestion list. Deleting a custom entry never
// strips the title from members already carrying it.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { MEMBER_TITLE_PRESETS, MAX_MEMBER_TITLE_LENGTH } from '@/lib/presets';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from('member_titles')
      .select('id, name, sort_order')
      .eq('account_id', ctx.accountId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('[GET /api/account/titles] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load member titles' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      presets: MEMBER_TITLE_PRESETS,
      custom: data ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:memberTitles:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
    } | null;

    const name = typeof body?.name === 'string' ? body.name.trim() : '';

    if (!name) {
      return NextResponse.json(
        { error: "'name' is required" },
        { status: 400 },
      );
    }
    if (name.length > MAX_MEMBER_TITLE_LENGTH) {
      return NextResponse.json(
        { error: `Title must be ${MAX_MEMBER_TITLE_LENGTH} characters or fewer` },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase
      .from('member_titles')
      .insert({ account_id: ctx.accountId, name })
      .select('id, name, sort_order')
      .single();

    if (error) {
      // Unique (account_id, lower(name)) violation.
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A custom title with that name already exists' },
          { status: 409 },
        );
      }
      console.error('[POST /api/account/titles] insert error:', error);
      return NextResponse.json(
        { error: 'Failed to create custom title' },
        { status: 500 },
      );
    }

    return NextResponse.json({ entry: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
