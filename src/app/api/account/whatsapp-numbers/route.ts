import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { canManageMembers } from '@/lib/auth/roles';
import type { WhatsAppConfig } from '@/types';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // Query whatsapp_config. RLS scopes this:
    // - owner/admin see all account numbers
    // - agent/viewer see only assigned numbers
    const { data: configs, error: configError } = await ctx.supabase
      .from('whatsapp_config')
      .select('id, user_id, account_id, phone_number_id, label, is_default, sort_order, waba_id, status, connected_at, registered_at, subscribed_apps_at, last_registration_error')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (configError) {
      console.error('[GET /api/account/whatsapp-numbers] fetch error:', configError);
      return NextResponse.json(
        { error: 'Failed to load WhatsApp numbers' },
        { status: 500 },
      );
    }

    let userAssignments: Record<string, string[]> | undefined = undefined;

    if (canManageMembers(ctx.role)) {
      const { data: assignments, error: assignError } = await ctx.supabase
        .from('agent_whatsapp_numbers')
        .select('user_id, whatsapp_config_id')
        .eq('account_id', ctx.accountId);

      if (!assignError && assignments) {
        userAssignments = {};
        for (const row of assignments) {
          if (!userAssignments[row.user_id]) {
            userAssignments[row.user_id] = [];
          }
          userAssignments[row.user_id].push(row.whatsapp_config_id);
        }
      }
    }

    return NextResponse.json({
      whatsapp_numbers: (configs || []) as WhatsAppConfig[],
      user_assignments: userAssignments,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
