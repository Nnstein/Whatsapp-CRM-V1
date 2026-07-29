'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Radio, Plus, Loader2 } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { getBroadcastStatus } from '@/lib/broadcast-status';

/**
 * Poll cadence while any broadcast is sending. Kept modest so we don't
 * beat on Supabase — the aggregate trigger in migration 003 keeps
 * counts consistent; we just need to surface the freshest snapshot.
 */
const POLL_INTERVAL_MS = 5_000;

function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function RateCell({
  value,
  total,
  color,
}: {
  value: number;
  total: number;
  /** Tailwind bg class for the fill, e.g. "bg-primary" */
  color: string;
}) {
  const pct = percent(value, total);
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
        {pct}%
      </span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface SenderProfile {
  full_name: string | null;
  email: string | null;
  account_role: string | null;
}

interface WhatsAppNumberMeta {
  label: string;
  phone_number_id: string;
}

function RoleBadge({ role }: { role?: string | null }) {
  if (!role) return null;
  const normalized = role.toLowerCase();
  const styles: Record<string, string> = {
    owner: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    admin: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    agent: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  };
  const cls = styles[normalized] ?? 'bg-muted text-muted-foreground border-border';
  const label = normalized.charAt(0).toUpperCase() + normalized.slice(1);

  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase ${cls}`}
    >
      {label}
    </span>
  );
}

export default function BroadcastsPage() {
  const router = useRouter();
  const canCreate = useCan('send-messages');
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, SenderProfile>>({});
  const [configsMap, setConfigsMap] = useState<Record<string, WhatsAppNumberMeta>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Used to kick off polling only while something is actively sending.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchBroadcasts() {
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('broadcasts')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      const rows = (data ?? []) as Broadcast[];
      const healed = rows.map((b) => {
        if (
          b.status === 'sending' &&
          b.total_recipients > 0 &&
          (b.sent_count + b.failed_count) >= b.total_recipients
        ) {
          const nextStatus =
            b.failed_count === b.total_recipients ? 'failed' : 'sent';
          supabase
            .from('broadcasts')
            .update({ status: nextStatus })
            .eq('id', b.id)
            .then(() => {});
          return { ...b, status: nextStatus as Broadcast['status'] };
        }
        return b;
      });
      setBroadcasts(healed);

      // Fetch profiles & whatsapp configs for sender tagging
      const userIds = [...new Set(healed.map((b) => b.user_id).filter(Boolean))];
      const configIds = [
        ...new Set(healed.map((b) => b.whatsapp_config_id).filter(Boolean)),
      ] as string[];

      const [profilesRes, configsRes] = await Promise.all([
        userIds.length > 0
          ? supabase
              .from('profiles')
              .select('user_id, full_name, email, account_role')
              .in('user_id', userIds)
          : Promise.resolve({ data: [] }),
        configIds.length > 0
          ? supabase
              .from('whatsapp_config')
              .select('id, label, phone_number_id')
              .in('id', configIds)
          : Promise.resolve({ data: [] }),
      ]);

      const profMap: Record<string, SenderProfile> = {};
      for (const p of (profilesRes.data ?? []) as any[]) {
        if (p.user_id) {
          profMap[p.user_id] = {
            full_name: p.full_name,
            email: p.email,
            account_role: p.account_role,
          };
        }
      }
      setProfilesMap(profMap);

      const cfgMap: Record<string, WhatsAppNumberMeta> = {};
      for (const c of (configsRes.data ?? []) as any[]) {
        if (c.id) {
          cfgMap[c.id] = {
            label: c.label,
            phone_number_id: c.phone_number_id,
          };
        }
      }
      setConfigsMap(cfgMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load broadcasts');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBroadcasts();
  }, []);

  const anySending = useMemo(
    () => broadcasts.some((b) => b.status === 'sending'),
    [broadcasts],
  );

  useEffect(() => {
    function startPolling() {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(fetchBroadcasts, POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (!pollTimer.current) return;
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }

    // Pause polling while the tab is hidden — keeps Supabase cold when
    // the user is away, and ensures a fresh fetch the moment they
    // refocus so they don't see stale data on return.
    function handleVisibilityChange() {
      if (!anySending) return;
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        fetchBroadcasts();
        startPolling();
      }
    }

    if (anySending && document.visibilityState === 'visible') {
      startPolling();
    } else {
      stopPolling();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [anySending]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top indeterminate progress bar: only visible while a broadcast
          is mid-send. Pure CSS animation so no extra deps. */}
      {anySending && (
        <div
          role="progressbar"
          aria-label="Broadcast in progress"
          className="broadcast-indeterminate fixed inset-x-0 top-0 z-40 h-0.5 overflow-hidden bg-muted"
        >
          <div className="broadcast-indeterminate-bar h-0.5 bg-primary" />
          <style jsx>{`
            .broadcast-indeterminate-bar {
              width: 33%;
              transform: translateX(-100%);
              animation: broadcast-slide 1.6s cubic-bezier(0.4, 0, 0.2, 1)
                infinite;
            }
            @keyframes broadcast-slide {
              0% {
                transform: translateX(-100%);
              }
              100% {
                transform: translateX(400%);
              }
            }
          `}</style>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Broadcasts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Send bulk messages to your contacts using approved templates.
          </p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="create broadcasts"
          onClick={() => router.push('/broadcasts/new')}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Broadcast
        </GatedButton>
      </div>

      {broadcasts.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-border bg-card">
          <Radio className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No broadcasts yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create your first broadcast to reach your contacts at scale.
          </p>
          <GatedButton
            canAct={canCreate}
            gateReason="create broadcasts"
            onClick={() => router.push('/broadcasts/new')}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New Broadcast
          </GatedButton>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Name</TableHead>
                <TableHead className="hidden text-muted-foreground md:table-cell">Template</TableHead>
                <TableHead className="hidden text-muted-foreground sm:table-cell">Sender / Role</TableHead>
                <TableHead className="hidden text-muted-foreground md:table-cell">WhatsApp Number</TableHead>
                <TableHead className="hidden text-right text-muted-foreground sm:table-cell">
                  Recipients
                </TableHead>
                <TableHead className="hidden text-muted-foreground lg:table-cell">Delivery</TableHead>
                <TableHead className="hidden text-muted-foreground lg:table-cell">Read</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="hidden text-muted-foreground sm:table-cell">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {broadcasts.map((broadcast) => {
                const status = getBroadcastStatus(broadcast.status);
                const prof = profilesMap[broadcast.user_id];
                const cfg = broadcast.whatsapp_config_id
                  ? configsMap[broadcast.whatsapp_config_id]
                  : undefined;

                return (
                  <TableRow
                    key={broadcast.id}
                    className="cursor-pointer border-border hover:bg-muted/50"
                    onClick={() => router.push(`/broadcasts/${broadcast.id}`)}
                  >
                    <TableCell className="font-medium text-foreground">
                      {broadcast.name}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {broadcast.template_name}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {prof ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-foreground font-medium">
                            {prof.full_name || prof.email || 'Unknown'}
                          </span>
                          <RoleBadge role={prof.account_role} />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {cfg ? (
                        <div>
                          <p className="text-xs font-medium text-foreground">{cfg.label}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{cfg.phone_number_id}</p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Default Number</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                      {broadcast.total_recipients}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <RateCell
                        value={broadcast.delivered_count}
                        total={broadcast.total_recipients}
                        color="bg-primary"
                      />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <RateCell
                        value={broadcast.read_count}
                        total={broadcast.total_recipients}
                        color="bg-blue-500"
                      />
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
                      >
                        {status.pulse && (
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400" />
                          </span>
                        )}
                        {status.label}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {new Date(broadcast.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
