import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

/**
 * PATCH /api/conversations/[id]/handling-mode
 *
 * Switch who is expected to reply to the customer: the AI bot ('ai')
 * or a human agent ('human').
 *
 *  - → 'human': the bot stands down (sticky until flipped back), and the
 *    thread is marked pending so the team picks it up.
 *  - → 'ai': the bot resumes — clears any agent assignment, re-enables
 *    auto-reply, and resets the per-conversation reply budget so the
 *    customer gets a fresh set of AI replies.
 *
 * Any account member may toggle (mirrors the client-side assignment
 * dropdown, which runs under RLS with the same membership rules).
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { supabase, accountId } = await getCurrentAccount();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return bad('Invalid JSON body');
    }

    const mode = body.mode;
    if (mode !== 'ai' && mode !== 'human') {
      return bad("'mode' must be 'ai' or 'human'");
    }

    // Scope check — the conversation must belong to the caller's account.
    const { data: conv, error: fetchErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (fetchErr || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const update =
      mode === 'ai'
        ? {
            handling_mode: 'ai',
            ai_autoreply_disabled: false,
            ai_reply_count: 0,
            assigned_agent_id: null,
          }
        : {
            handling_mode: 'human',
            ai_autoreply_disabled: true,
            status: 'pending',
          };

    const { data: updated, error } = await supabase
      .from('conversations')
      .update(update)
      .eq('id', id)
      .select('id, handling_mode, assigned_agent_id, ai_reply_count, status')
      .single();

    if (error) {
      console.error('[handling-mode PATCH] update error:', error);
      return NextResponse.json({ error: 'Failed to update handling mode' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, conversation: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
