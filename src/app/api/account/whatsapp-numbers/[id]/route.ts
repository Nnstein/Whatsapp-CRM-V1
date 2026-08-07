// ============================================================
// /api/account/whatsapp-numbers/[id]
//
//   PATCH — update a number's light metadata. Admin+.
//
// Handles the non-credential fields only: label, inbox_group,
// sort_order. Credential changes (token, phone_number_id, PIN, …)
// still go through POST /api/whatsapp/config, which re-verifies with
// Meta — this route exists so grouping/renaming a number never
// requires re-entering the access token.
//
// Writes go through the RLS-scoped SSR client; whatsapp_config_update
// already requires admin, and requireRole('admin') above gives a
// friendly 403 instead of a raw DB error.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { MAX_INBOX_GROUP_LENGTH } from '@/lib/presets';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:whatsAppNumberMeta:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const body = (await request.json().catch(() => null)) as {
      label?: unknown;
      inbox_group?: unknown;
      sort_order?: unknown;
    } | null;

    const update: Record<string, string | number | null> = {};

    if (body && 'label' in body) {
      if (typeof body.label !== 'string' || !body.label.trim()) {
        return NextResponse.json(
          { error: "'label' must be a non-empty string" },
          { status: 400 },
        );
      }
      if (body.label.trim().length > 80) {
        return NextResponse.json(
          { error: "'label' must be 80 characters or fewer" },
          { status: 400 },
        );
      }
      update.label = body.label.trim();
    }

    if (body && 'inbox_group' in body) {
      // null clears the group; a string sets it.
      if (body.inbox_group !== null && typeof body.inbox_group !== 'string') {
        return NextResponse.json(
          { error: "'inbox_group' must be a string or null" },
          { status: 400 },
        );
      }
      const group =
        typeof body.inbox_group === 'string'
          ? body.inbox_group.trim() || null
          : null;
      if (group && group.length > MAX_INBOX_GROUP_LENGTH) {
        return NextResponse.json(
          { error: `Group name must be ${MAX_INBOX_GROUP_LENGTH} characters or fewer` },
          { status: 400 },
        );
      }
      update.inbox_group = group;
    }

    if (body && 'sort_order' in body) {
      if (
        typeof body.sort_order !== 'number' ||
        !Number.isInteger(body.sort_order)
      ) {
        return NextResponse.json(
          { error: "'sort_order' must be an integer" },
          { status: 400 },
        );
      }
      update.sort_order = body.sort_order;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'Provide at least one of: label, inbox_group, sort_order' },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase
      .from('whatsapp_config')
      .update(update)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id, label, inbox_group, sort_order')
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/account/whatsapp-numbers/[id]] error:', error);
      return NextResponse.json(
        { error: 'Failed to update WhatsApp number' },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'WhatsApp number not found in this account' },
        { status: 404 },
      );
    }

    return NextResponse.json({ number: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
