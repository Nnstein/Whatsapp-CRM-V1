"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  matchesContactFilters,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Tag } from "@/types";
import { Search, ChevronDown, X, Bot, UserRound } from "lucide-react";
import { getEffectiveHandler } from "@/lib/inbox/handling-mode";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};

/** Window status colors for the conversation list indicator. */
const WINDOW_STATUS_COLORS = {
  open: "bg-emerald-500",
  expired: "bg-red-500",
  unknown: "bg-gray-400",
} as const;

export interface NumberColorStyle {
  dot: string;
  text: string;
  bg: string;
  border: string;
}

const NUMBER_COLORS: NumberColorStyle[] = [
  { dot: "bg-emerald-500", text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  { dot: "bg-indigo-500", text: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/30" },
  { dot: "bg-amber-500", text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  { dot: "bg-rose-500", text: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/30" },
  { dot: "bg-violet-500", text: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/30" },
  { dot: "bg-cyan-500", text: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/30" },
];

type InboxFilter = ConversationStatus | "all" | "unread";

const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = [
  { label: "All", value: "all" },
  { label: "Unread", value: "unread" },
  { label: "Open", value: "open" },
  { label: "Pending", value: "pending" },
  { label: "Closed", value: "closed" },
];

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [loading, setLoading] = useState(true);
  const [whatsappNumbers, setWhatsappNumbers] = useState<import("@/types").WhatsAppConfig[]>([]);
  const [selectedNumberId, setSelectedNumberId] = useState<string | null>(null);

  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      let query = supabase
        .from("conversations")
        .select(CONVERSATION_SELECT);

      if (selectedNumberId) {
        query = query.eq("whatsapp_config_id", selectedNumberId);
      }

      const { data, error } = await query.order("last_message_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(normalizeConversations(data ?? []));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [resyncToken, selectedNumberId]);

  // Load WhatsApp numbers available to the caller for filtering
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/account/whatsapp-numbers");
        const data = await res.json();
        if (!cancelled && res.ok && Array.isArray(data.whatsapp_numbers)) {
          setWhatsappNumbers(data.whatsapp_numbers);
        }
      } catch (err) {
        console.error("Failed to load WhatsApp numbers for inbox:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resyncToken]);

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const numbersMap = useMemo(() => {
    const m = new Map<string, import("@/types").WhatsAppConfig>();
    for (const num of whatsappNumbers) m.set(num.id, num);
    return m;
  }, [whatsappNumbers]);

  const numberColorsMap = useMemo(() => {
    const m = new Map<string, NumberColorStyle>();
    whatsappNumbers.forEach((num, index) => {
      m.set(num.id, NUMBER_COLORS[index % NUMBER_COLORS.length]);
    });
    return m;
  }, [whatsappNumbers]);

  // Group numbers by their inbox_group label (migration 039) for the
  // selector dropdown. Groups sort alphabetically; ungrouped numbers
  // come last under an "Ungrouped" label (only shown when at least
  // one group exists — otherwise the list stays flat as before).
  const groupedNumbers = useMemo(() => {
    const groups = new Map<string, typeof whatsappNumbers>();
    const ungrouped: typeof whatsappNumbers = [];
    for (const num of whatsappNumbers) {
      const g = num.inbox_group?.trim();
      if (g) {
        const arr = groups.get(g) ?? [];
        arr.push(num);
        groups.set(g, arr);
      } else {
        ungrouped.push(num);
      }
    }
    const sorted = Array.from(groups.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return { groups: sorted, ungrouped, hasGroups: sorted.length > 0 };
  }, [whatsappNumbers]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (selectedNumberId) {
      result = result.filter((c) => c.whatsapp_config_id === selectedNumberId);
    }

    if (filter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    // Contact-based filters (tags via OR logic, exact company match).
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        })
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result;
  }, [conversations, selectedNumberId, filter, search, selectedTagIds, selectedCompany]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const hasContactFilters = selectedTagIds.length > 0 || selectedCompany !== null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);
  const activeNumber = whatsappNumbers.find((n) => n.id === selectedNumberId);
  const activeNumberColor = activeNumber ? numberColorsMap.get(activeNumber.id) : null;

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
      {/* Number Selector Header (shown if user has access to multiple numbers) */}
      {whatsappNumbers.length > 1 && (
        <div className="border-b border-border p-2 bg-muted/30">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-xs font-medium text-foreground bg-muted/60 hover:bg-muted rounded-md border border-border">
              <span className="truncate flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full shrink-0", activeNumberColor?.dot ?? "bg-emerald-500")} />
                {activeNumber ? activeNumber.label : "All Inboxes"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 border-border bg-popover">
              <DropdownMenuItem
                onClick={() => setSelectedNumberId(null)}
                className={cn(
                  "text-xs font-medium flex items-center justify-between",
                  selectedNumberId === null ? "text-primary font-semibold" : "text-popover-foreground"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  <span>All Inboxes</span>
                </div>
                <span className="text-[10px] text-muted-foreground">{whatsappNumbers.length} numbers</span>
              </DropdownMenuItem>
              {(() => {
                const renderNumberItem = (num: (typeof whatsappNumbers)[number]) => {
                  const numColor = numberColorsMap.get(num.id);
                  return (
                    <DropdownMenuItem
                      key={num.id}
                      onClick={() => setSelectedNumberId(num.id)}
                      className={cn(
                        "text-xs flex items-center justify-between gap-2",
                        selectedNumberId === num.id ? "text-primary font-semibold" : "text-popover-foreground"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", numColor?.dot ?? "bg-emerald-500")} />
                        <div className="flex flex-col min-w-0">
                          <span className="truncate">{num.label}</span>
                          <span className="text-[10px] text-muted-foreground truncate">{num.phone_number_id}</span>
                        </div>
                      </div>
                      {num.is_default && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium shrink-0">Default</span>
                      )}
                    </DropdownMenuItem>
                  );
                };

                // Flat list when no groups are in use — identical to
                // the pre-grouping selector.
                if (!groupedNumbers.hasGroups) {
                  return whatsappNumbers.map(renderNumberItem);
                }

                return (
                  <>
                    {groupedNumbers.groups.map(([groupName, nums]) => (
                      <DropdownMenuGroup key={groupName}>
                        <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {groupName}
                        </DropdownMenuLabel>
                        {nums.map(renderNumberItem)}
                      </DropdownMenuGroup>
                    ))}
                    {groupedNumbers.ungrouped.length > 0 && (
                      <DropdownMenuGroup>
                        <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Ungrouped
                        </DropdownMenuLabel>
                        {groupedNumbers.ungrouped.map(renderNumberItem)}
                      </DropdownMenuGroup>
                    )}
                  </>
                );
              })()}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Search + Filter */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder="Search conversations..."
            className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                {activeFilter?.label ?? "All"}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "text-sm",
                    filter === opt.value
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {tags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedTagIds.length > 0
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Tags
                {selectedTagIds.length > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {selectedTagIds.length}
                  </span>
                )}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                {tags.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={() => toggleTag(t.id)}
                    className="text-sm text-popover-foreground"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex max-w-40 items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedCompany
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">{selectedCompany ?? "Company"}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(
                    "text-sm",
                    selectedCompany === null
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  All companies
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(
                      "text-sm",
                      selectedCompany === co
                        ? "text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag?.color ?? "var(--muted-foreground)" }}
                  />
                  <span className="max-w-24 truncate">{tag?.name ?? "Tag"}</span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Conversation Items */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">No conversations found</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                numberLabel={whatsappNumbers.length > 1 ? numbersMap.get(conv.whatsapp_config_id)?.label : undefined}
                numberColor={whatsappNumbers.length > 1 ? numberColorsMap.get(conv.whatsapp_config_id) : undefined}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  numberLabel?: string;
  numberColor?: NumberColorStyle;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  numberLabel,
  numberColor,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || "Unknown";
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : "";

  const now = Date.now();
  const windowExpires = conversation.window_expires_at
    ? new Date(conversation.window_expires_at).getTime()
    : null;
  const windowOpen = windowExpires ? windowExpires > now : false;
  const windowColor = windowExpires
    ? windowOpen
      ? WINDOW_STATUS_COLORS.open
      : WINDOW_STATUS_COLORS.expired
    : WINDOW_STATUS_COLORS.unknown;
  const windowTitle = windowExpires
    ? windowOpen
      ? "24h window open — free-form messages allowed"
      : "24h window expired — templates only"
    : "No inbound message yet — window status unknown";

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50",
        isActive && "border-l-2 border-primary bg-muted/70"
      )}
    >
      {/* Avatar */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground relative">
        {contact?.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-sm font-medium text-foreground">
              {displayName}
            </span>
            {numberLabel && (
              <span className={cn(
                "shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-mono font-medium flex items-center gap-1",
                numberColor
                  ? `${numberColor.bg} ${numberColor.text} ${numberColor.border}`
                  : "bg-muted/80 border-border/80 text-muted-foreground"
              )}>
                {numberColor && <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", numberColor.dot)} />}
                {numberLabel}
              </span>
            )}
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {conversation.last_message_text || "No messages yet"}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {conversation.unread_count}
              </span>
            )}
            {/* AI/Human handler indicator — who is expected to reply. */}
            {getEffectiveHandler(conversation) === "ai" ? (
              <Bot
                className="h-3 w-3 shrink-0 text-primary"
                aria-label="Handled by AI"
              />
            ) : (
              <UserRound
                className="h-3 w-3 shrink-0 text-amber-500"
                aria-label="Handled by a human"
              />
            )}
            {/* 24h window status indicator */}
            <span
              className={cn("h-2 w-2 rounded-full", windowColor)}
              title={windowTitle}
            />
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>
      </div>
    </button>
  );
}
