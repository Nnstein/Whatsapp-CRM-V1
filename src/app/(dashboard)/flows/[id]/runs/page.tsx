"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  CircleCheck,
  CircleAlert,
  Clock,
  UserPlus,
  PlayCircle,
  PauseCircle,
  ChevronDown,
  ChevronRight,
  Download,
  Table as TableIcon,
  ListFilter,
  Tag as TagIcon,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Run history & Responses viewer.
 *
 * Lists the runs for a flow with dual views:
 *   1. "Responses & Inputs" data table with CSV export (Contact + Tags + Collected Vars)
 *   2. "Execution Timeline" per-step log for debugging.
 */

interface TagItem {
  id: string;
  name: string;
  color?: string;
}

interface RunRow {
  id: string;
  status:
    | "active"
    | "completed"
    | "handed_off"
    | "timed_out"
    | "paused_by_agent"
    | "failed";
  current_node_key: string | null;
  started_at: string;
  last_advanced_at: string;
  ended_at: string | null;
  end_reason: string | null;
  vars: Record<string, unknown>;
  reprompt_count: number;
  contact: {
    id: string;
    name: string | null;
    phone: string;
    contact_tags?: Array<{ tag: TagItem }>;
  } | null;
}

interface EventRow {
  flow_run_id: string;
  event_type: string;
  node_key: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

const STATUS_META: Record<
  RunRow["status"],
  { label: string; classes: string; icon: typeof Clock }
> = {
  active: {
    label: "Active",
    classes: "border-emerald-600/40 bg-emerald-500/10 text-emerald-300",
    icon: PlayCircle,
  },
  completed: {
    label: "Completed",
    classes: "border-border bg-muted text-muted-foreground",
    icon: CircleCheck,
  },
  handed_off: {
    label: "Handed off",
    classes: "border-amber-600/40 bg-amber-500/10 text-amber-300",
    icon: UserPlus,
  },
  timed_out: {
    label: "Timed out",
    classes: "border-border bg-muted/60 text-muted-foreground",
    icon: Clock,
  },
  paused_by_agent: {
    label: "Paused by agent",
    classes: "border-border bg-muted text-muted-foreground",
    icon: PauseCircle,
  },
  failed: {
    label: "Failed",
    classes: "border-red-600/40 bg-red-500/10 text-red-300",
    icon: CircleAlert,
  },
};

function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row.map((cell) => `"${(cell ?? "").replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");
}

function downloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FlowRunsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const [flow, setFlow] = useState<{ id: string; name: string } | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState<"responses" | "timeline">("responses");

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/flows/${params.id}/runs`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const json = (await res.json()) as {
          flow: { id: string; name: string };
          runs: RunRow[];
          events: EventRow[];
        };
        if (!cancelled) {
          setFlow(json.flow);
          setRuns(json.runs ?? []);
          setEvents(json.events ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error("Couldn't load flow runs.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  // Extract all unique variable keys captured across all runs in this flow
  const allVarKeys = useMemo(() => {
    const keysSet = new Set<string>();
    runs.forEach((r) => {
      if (r.vars && typeof r.vars === "object") {
        Object.keys(r.vars).forEach((k) => keysSet.add(k));
      }
    });
    return Array.from(keysSet);
  }, [runs]);

  function handleExportCsv() {
    if (!flow || runs.length === 0) return;

    const headers = [
      "Contact Name",
      "Phone Number",
      "Run Status",
      "Started At",
      "Tags",
      ...allVarKeys,
    ];

    const rows = runs.map((r) => {
      const contactName = r.contact?.name || "";
      const phone = r.contact?.phone || "";
      const status = r.status;
      const startedAt = format(new Date(r.started_at), "yyyy-MM-dd HH:mm:ss");
      const tags = (r.contact?.contact_tags ?? [])
        .map((ct) => ct.tag?.name)
        .filter(Boolean)
        .join("; ");

      const varValues = allVarKeys.map((k) => {
        const val = r.vars?.[k];
        if (val === undefined || val === null) return "";
        if (typeof val === "object") return JSON.stringify(val);
        return String(val);
      });

      return [contactName, phone, status, startedAt, tags, ...varValues];
    });

    const csvContent = toCsv([headers, ...rows]);
    const safeName = flow.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
    downloadBlob(`${safeName}-responses.csv`, csvContent);
    toast.success("Downloaded responses CSV!");
  }

  function toggle(runId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !flow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Flow not found.</p>
        <button
          type="button"
          onClick={() => router.push("/flows")}
          className="text-sm text-primary hover:opacity-80"
        >
          ← Back to flows
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <button
        type="button"
        onClick={() => router.push(`/flows/${flow.id}`)}
        className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        {flow.name}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Flow Responses & Runs
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            View captured user inputs, tags, and execution history for &ldquo;{flow.name}&rdquo;.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={runs.length === 0}
            className="gap-1.5 text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            Download Responses CSV
          </Button>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="mt-4 flex border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("responses")}
          className={cn(
            "flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-medium transition-colors",
            activeTab === "responses"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <TableIcon className="h-3.5 w-3.5" />
          Collected Responses ({runs.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("timeline")}
          className={cn(
            "flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-medium transition-colors",
            activeTab === "timeline"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <ListFilter className="h-3.5 w-3.5" />
          Execution Timeline
        </button>
      </div>

      {/* TAB 1: Collected Responses Data Table */}
      {activeTab === "responses" && (
        <div className="mt-4">
          {runs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center text-sm text-muted-foreground">
              No responses recorded yet. Trigger the flow to start collecting customer inputs.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Contact</th>
                    <th className="px-4 py-3 font-medium">Tags</th>
                    <th className="px-4 py-3 font-medium">Collected Variables</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {runs.map((run) => {
                    const contactName = run.contact?.name || "Contact";
                    const phone = run.contact?.phone || "";
                    const tags = (run.contact?.contact_tags ?? [])
                      .map((ct) => ct.tag)
                      .filter(Boolean);
                    const meta = STATUS_META[run.status];
                    const StatusIcon = meta.icon;
                    const varsEntries = Object.entries(run.vars || {});

                    return (
                      <tr
                        key={run.id}
                        className="transition-colors hover:bg-muted/30"
                      >
                        {/* Contact Cell */}
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                              {contactName.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground truncate">
                                {contactName}
                              </p>
                              <p className="text-[11px] text-muted-foreground font-mono">
                                {phone}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Tags Cell */}
                        <td className="px-4 py-3 align-top">
                          {tags.length === 0 ? (
                            <span className="text-[11px] text-muted-foreground/60">
                              No tags
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {tags.map((t) => (
                                <Badge
                                  key={t.id}
                                  variant="outline"
                                  className="gap-1 border-border bg-muted/60 text-[10px] font-normal"
                                >
                                  <TagIcon className="h-2.5 w-2.5 text-primary" />
                                  {t.name}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>

                        {/* Collected Variables Cell */}
                        <td className="px-4 py-3 align-top">
                          {varsEntries.length === 0 ? (
                            <span className="text-[11px] font-italic text-muted-foreground/60">
                              No inputs collected
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {varsEntries.map(([k, v]) => (
                                <div
                                  key={k}
                                  className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px]"
                                >
                                  <span className="font-medium text-primary font-mono">
                                    {k}:
                                  </span>
                                  <span className="text-foreground">
                                    {typeof v === "object"
                                      ? JSON.stringify(v)
                                      : String(v)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>

                        {/* Status Cell */}
                        <td className="px-4 py-3 align-top">
                          <Badge
                            variant="outline"
                            className={cn("gap-1 text-[10px]", meta.classes)}
                          >
                            <StatusIcon className="h-3 w-3" />
                            {meta.label}
                          </Badge>
                        </td>

                        {/* Date Cell */}
                        <td className="px-4 py-3 align-top text-muted-foreground whitespace-nowrap">
                          {format(new Date(run.started_at), "MMM d, yyyy HH:mm")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Execution Timeline */}
      {activeTab === "timeline" && (
        <div className="mt-4 flex flex-col gap-2">
          {runs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center text-sm text-muted-foreground">
              No execution runs recorded yet.
            </div>
          ) : (
            runs.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                events={events.filter((e) => e.flow_run_id === run.id)}
                expanded={expanded.has(run.id)}
                onToggle={() => toggle(run.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function RunCard({
  run,
  events,
  expanded,
  onToggle,
}: {
  run: RunRow;
  events: EventRow[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = STATUS_META[run.status];
  const StatusIcon = meta.icon;
  const contactLabel =
    run.contact?.name?.trim() || run.contact?.phone || "Unknown contact";
  const duration = run.ended_at
    ? formatDistanceToNow(new Date(run.ended_at), {
        addSuffix: false,
      })
    : null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {contactLabel}
            </span>
            <Badge variant="outline" className={cn("gap-1", meta.classes)}>
              <StatusIcon className="h-3 w-3" />
              {meta.label}
            </Badge>
            {run.status === "active" && run.current_node_key && (
              <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                at {run.current_node_key}
              </code>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>Started {format(new Date(run.started_at), "PP p")}</span>
            {run.reprompt_count > 0 && (
              <span>· {run.reprompt_count} re-prompts</span>
            )}
            {duration && <span>· ran for {duration}</span>}
          </div>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3">
          {Object.keys(run.vars).length > 0 && (
            <details className="mb-3">
              <summary className="cursor-pointer text-xs text-muted-foreground font-medium">
                Captured vars ({Object.keys(run.vars).length})
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-md bg-background p-2 text-[11px] text-muted-foreground">
                {JSON.stringify(run.vars, null, 2)}
              </pre>
            </details>
          )}
          <div className="flex flex-col gap-1">
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No events recorded for this run.
              </p>
            ) : (
              events.map((ev, ix) => <EventLine key={ix} ev={ev} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const EVENT_COLOR: Record<string, string> = {
  started: "text-emerald-300",
  node_entered: "text-muted-foreground",
  message_sent: "text-sky-300",
  reply_received: "text-primary",
  fallback_fired: "text-amber-300",
  handoff: "text-amber-300",
  timeout: "text-muted-foreground",
  error: "text-red-300",
  completed: "text-emerald-300",
};

function EventLine({ ev }: { ev: EventRow }) {
  const cls = EVENT_COLOR[ev.event_type] ?? "text-muted-foreground";
  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-1 text-xs">
      <span className="w-32 shrink-0 text-[10px] text-muted-foreground">
        {format(new Date(ev.created_at), "HH:mm:ss")}
      </span>
      <span className={cn("w-32 shrink-0 font-mono text-[10px]", cls)}>
        {ev.event_type}
      </span>
      {ev.node_key && (
        <code className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
          {ev.node_key}
        </code>
      )}
      {Object.keys(ev.payload).length > 0 && (
        <span className="min-w-0 truncate text-[10px] text-muted-foreground">
          {summarizePayload(ev.payload)}
        </span>
      )}
    </div>
  );
}

function summarizePayload(payload: Record<string, unknown>): string {
  const keys = ["reply_id", "captured_key", "reason", "advancing_to"];
  for (const k of keys) {
    if (k in payload && payload[k] !== null && payload[k] !== undefined) {
      return `${k}=${String(payload[k]).slice(0, 80)}`;
    }
  }
  return "";
}
