// ============================================================
// /api/account/inbox-groups — inbox-group vocabulary (migration 039)
//
//   GET  — any member. Returns the generic preset list plus the
//          account's custom groups (pickers merge the two).
//   POST — admin+. Adds a custom group to the account vocabulary.
//
// Groups themselves live as free text on whatsapp_config.inbox_group;
// this table is only a curated suggestion list. Deleting a custom
// entry never ungroups numbers already carrying the label.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { INBOX_GROUP_PRESETS, MAX_INBOX_GROUP_LENGTH } from '@/lib/presets';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from('inbox_groups')
      .select('id, name, sort_order')
      .eq('account_id', ctx.accountId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('[GET /api/account/inbox-groups] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load inbox groups' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      presets: INBOX_GROUP_PRESETS,
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
      `admin:inboxGroups:${ctx.userId}`,
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
    if (name.length > MAX_INBOX_GROUP_LENGTH) {
      return NextResponse.json(
        { error: `Group name must be ${MAX_INBOX_GROUP_LENGTH} characters or fewer` },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase
      .from('inbox_groups')
      .insert({ account_id: ctx.accountId, name })
      .select('id, name, sort_order')
      .single();

    if (error) {
      // Unique (account_id, lower(name)) violation.
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A custom group with that name already exists' },
          { status: 409 },
        );
      }
      console.error('[POST /api/account/inbox-groups] insert error:', error);
      return NextResponse.json(
        { error: 'Failed to create custom group' },
        { status: 500 },
      );
    }

    return NextResponse.json({ entry: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
