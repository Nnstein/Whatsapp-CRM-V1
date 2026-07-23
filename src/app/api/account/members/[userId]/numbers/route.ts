import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:memberNumbers:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as {
      whatsapp_config_ids?: unknown;
    } | null;

    if (!Array.isArray(body?.whatsapp_config_ids)) {
      return NextResponse.json(
        { error: "'whatsapp_config_ids' must be an array of string UUIDs" },
        { status: 400 }
      );
    }

    const configIds = (body.whatsapp_config_ids as unknown[]).filter(
      (id): id is string => typeof id === 'string'
    );

    // Verify that the target user is a member of this account
    const { data: targetProfile, error: profileErr } = await ctx.supabase
      .from('profiles')
      .select('user_id, account_role')
      .eq('user_id', userId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (profileErr || !targetProfile) {
      return NextResponse.json(
        { error: 'Member not found in this account' },
        { status: 404 }
      );
    }

    // Validate up-front that all supplied config IDs belong to this account
    if (configIds.length > 0) {
      const { data: validConfigs } = await ctx.supabase
        .from('whatsapp_config')
        .select('id')
        .eq('account_id', ctx.accountId)
        .in('id', configIds);

      const validIds = new Set((validConfigs || []).map((c) => c.id));
      const invalidIds = configIds.filter((id) => !validIds.has(id));

      if (invalidIds.length > 0) {
        return NextResponse.json(
          { error: 'One or more provided WhatsApp config IDs do not belong to this account' },
          { status: 400 }
        );
      }
    }

    // Delete existing assignments for this member
    const { error: deleteErr } = await ctx.supabase
      .from('agent_whatsapp_numbers')
      .delete()
      .eq('account_id', ctx.accountId)
      .eq('user_id', userId);

    if (deleteErr) {
      console.error('[members numbers PATCH] delete error:', deleteErr);
      return NextResponse.json(
        { error: 'Failed to update member numbers' },
        { status: 500 }
      );
    }

    // Insert new assignments if any selected
    if (configIds.length > 0) {
      const rowsToInsert = configIds.map((configId) => ({
        account_id: ctx.accountId,
        user_id: userId,
        whatsapp_config_id: configId,
      }));

      const { error: insertErr } = await ctx.supabase
        .from('agent_whatsapp_numbers')
        .insert(rowsToInsert);

      if (insertErr) {
        console.error('[members numbers PATCH] insert error:', insertErr);
        return NextResponse.json(
          { error: 'Failed to insert member number assignments' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
