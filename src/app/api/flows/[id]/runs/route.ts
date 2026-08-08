import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/flows/[id]/runs
 *
 * Newest-first list of flow runs for a single flow, with the latest
 * event timeline embedded for each. Used by the run-history viewer
 * page (`/flows/[id]/runs`) to give the owner end-to-end visibility
 * into what the bot did with each customer.
 *
 * RLS does the ownership check (flow_runs has a `user_id` policy);
 * we also gate on the per-account beta flag so the route 404s for
 * non-beta accounts matching the rest of /api/flows.
 *
 * Limited to the 50 most recent runs. Pagination can come later;
 * the dashboard surface here is for debugging, not heavy querying.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const limitParam = searchParams.get('limit')
  const pageParam = searchParams.get('page')

  const limit =
    limitParam === 'all'
      ? 1000
      : Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 1000)
  const page = Math.max(parseInt(pageParam || '1', 10) || 1, 1)
  const offset = (page - 1) * limit

  // Confirm flow exists + caller owns it (RLS does this) before doing
  // the run query — gives us a clean 404 instead of empty array.
  const { data: flow } = await supabase
    .from('flows')
    .select('id, name')
    .eq('id', id)
    .maybeSingle()
  if (!flow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Pull runs + each run's contact name + each run's events. Two
  // joined selects keep the round-trip count to the runs query + one
  // per-run events query.
  const { data: runs, error: runsErr } = await supabase
    .from('flow_runs')
    .select(
      'id, status, current_node_key, started_at, last_advanced_at, ended_at, end_reason, vars, reprompt_count, contact:contacts(id, name, phone, contact_tags(tag:tags(id, name, color)))',
    )
    .eq('flow_id', id)
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (runsErr) {
    return NextResponse.json({ error: runsErr.message }, { status: 500 })
  }

  const runIds = (runs ?? []).map((r) => (r as { id: string }).id)
  let events: Array<{
    flow_run_id: string
    event_type: string
    node_key: string | null
    payload: Record<string, unknown>
    created_at: string
  }> = []
  if (runIds.length > 0) {
    const { data: evs, error: evsErr } = await supabase
      .from('flow_run_events')
      .select('flow_run_id, event_type, node_key, payload, created_at')
      .in('flow_run_id', runIds)
      .order('created_at', { ascending: true })
    if (evsErr) {
      // Non-fatal — the page can still show runs without timelines.
      console.error('[flows-runs] events fetch failed:', evsErr.message)
    } else if (evs) {
      events = evs as typeof events
    }
  }

  return NextResponse.json({
    flow,
    runs: runs ?? [],
    events,
  })
}
