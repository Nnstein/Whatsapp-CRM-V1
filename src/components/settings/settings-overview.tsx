'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { THEMES } from '@/lib/themes';
import { CURRENCIES, DEFAULT_CURRENCY } from '@/lib/currency';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { SECTION_META, type SettingsSection } from './settings-sections';
import { SettingsChip, StatusDot } from './settings-chip';
import { ROLE_META } from './role-meta';

interface OverviewCounts {
  members: number | null;
  pendingInvites: number | null;
  templates: number | null;
  templatesPending: number | null;
  tags: number | null;
  customFields: number | null;
}

interface WhatsAppStatus {
  configured: boolean;
  connected: boolean;
}

export function SettingsOverview({
  onSelect,
}: {
  onSelect: (section: SettingsSection) => void;
}) {
  const { user, profile, accountId, accountRole, defaultCurrency, canManageMembers } =
    useAuth();
  const { mode, theme } = useTheme();

  const [counts, setCounts] = useState<OverviewCounts | null>(null);
  const [countsLoading, setCountsLoading] = useState(true);
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatus | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState(true);

  useEffect(() => {
    if (!user || !accountId) return;
    let cancelled = false;
    const supabase = createClient();
    const userId = user.id;

    // Cheap counts — resolve fast, render immediately.
    (async () => {
      setCountsLoading(true);
      const [membersRes, invitesRes, tagsRes, fieldsRes] =
        await Promise.allSettled([
          fetch('/api/account/members', { cache: 'no-store' }).then((r) => r.json()),
          canManageMembers
            ? fetch('/api/account/invitations', { cache: 'no-store' }).then((r) =>
                r.json(),
              )
            : Promise.resolve(null),
          supabase
            .from('tags')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId),
          supabase.from('custom_fields').select('id', { count: 'exact', head: true }),
        ]);

      if (cancelled) return;

      const members =
        membersRes.status === 'fulfilled' && Array.isArray(membersRes.value?.members)
          ? membersRes.value.members.length
          : null;
      const pendingInvites =
        invitesRes.status === 'fulfilled' &&
        invitesRes.value &&
        Array.isArray(invitesRes.value.invitations)
          ? invitesRes.value.invitations.length
          : null;

      setCounts({
        members,
        pendingInvites,
        templates: null,
        templatesPending: null,
        tags: tagsRes.status === 'fulfilled' ? tagsRes.value.count ?? 0 : null,
        customFields: fieldsRes.status === 'fulfilled' ? fieldsRes.value.count ?? 0 : null,
      });
      setCountsLoading(false);
    })();

    // WhatsApp status
    (async () => {
      setWhatsappLoading(true);
      try {
        const res = await fetch('/api/whatsapp/config', { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) {
            setWhatsapp({ configured: false, connected: false });
            setWhatsappLoading(false);
          }
          return;
        }
        const data = await res.json();
        if (cancelled) return;

        if (!data.configured) {
          setWhatsapp({ configured: false, connected: false });
        } else {
          const testRes = await fetch('/api/whatsapp/test-connection', {
            method: 'POST',
            cache: 'no-store',
          });
          const testData = await testRes.json();
          setWhatsapp({
            configured: true,
            connected: testRes.ok && testData.status === 'connected',
          });
        }
      } catch {
        if (!cancelled) setWhatsapp({ configured: false, connected: false });
      } finally {
        if (!cancelled) setWhatsappLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, accountId, canManageMembers]);

  const roleMeta = accountRole ? ROLE_META[accountRole] : null;
  const RoleIcon = roleMeta?.icon;

  const displayName =
    profile?.full_name?.trim() ||
    user?.email?.split('@')[0] ||
    'Account Member';

  const initial = (displayName.charAt(0) || 'A').toUpperCase();

  const themeName = THEMES.find((t) => t.id === theme)?.name ?? 'Violet';
  const curr = defaultCurrency ?? DEFAULT_CURRENCY;
  const currencyLabel = CURRENCIES.find((c) => c.code === curr)?.label ?? curr;

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const tiles: {
    section: SettingsSection;
    loading: boolean;
    subtitle: ReactNode;
  }[] = [
    {
      section: 'whatsapp',
      loading: whatsappLoading,
      subtitle: !whatsapp?.configured ? (
        <>
          <StatusDot tone="muted" /> Not configured
        </>
      ) : whatsapp.connected ? (
        <>
          <StatusDot tone="ok" /> Connected to Meta
        </>
      ) : (
        <>
          <StatusDot tone="muted" /> Token or phone ID invalid
        </>
      ),
    },
    {
      section: 'ai',
      loading: false,
      subtitle: 'Multi-provider AI, Auto-reply & Contact Auto-enrichment',
    },
    {
      section: 'members',
      loading: countsLoading,
      subtitle:
        counts?.members == null
          ? 'Manage team'
          : `${counts.members} member${counts.members === 1 ? '' : 's'}${
              counts.pendingInvites ? ` · ${counts.pendingInvites} pending` : ''
            }`,
    },
    {
      section: 'templates',
      loading: countsLoading,
      subtitle: 'WhatsApp Message Templates',
    },
    {
      section: 'deals',
      loading: false,
      subtitle: `${curr} — ${currencyLabel}`,
    },
    {
      section: 'fields',
      loading: countsLoading,
      subtitle:
        counts?.tags == null && counts?.customFields == null
          ? 'Tags and custom fields'
          : `${counts?.tags ?? 0} tag${counts?.tags === 1 ? '' : 's'} · ${
              counts?.customFields ?? 0
            } custom field${counts?.customFields === 1 ? '' : 's'}`,
    },
    {
      section: 'appearance',
      loading: false,
      subtitle: `${cap(mode)} mode · ${themeName} accent`,
    },
  ];

  return (
    <section className="animate-in fade-in-50 duration-200">
      {/* Identity */}
      <Card className="flex-row items-center gap-4 px-5 py-5">
        <Avatar size="lg" className="size-14">
          {profile?.avatar_url ? (
            <AvatarImage src={profile.avatar_url} alt={displayName} />
          ) : null}
          <AvatarFallback className="bg-primary/10 text-xl text-primary">
            {initial}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-foreground">
            {displayName}
          </div>
          {profile?.email ? (
            <div className="truncate text-sm text-muted-foreground">
              {profile.email}
            </div>
          ) : null}
        </div>
        {roleMeta && RoleIcon ? (
          <SettingsChip variant={roleMeta.variant}>
            <RoleIcon />
            {roleMeta.label}
          </SettingsChip>
        ) : null}
      </Card>

      {/* Status tiles */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map(({ section, loading, subtitle }) => {
          const meta = SECTION_META[section];
          const Icon = meta.icon;
          return (
            <button
              key={section}
              type="button"
              onClick={() => onSelect(section)}
              className={cn(
                'group flex items-start gap-3.5 rounded-xl border border-border bg-card p-4 text-left transition-colors',
                'hover:border-primary-soft-2 hover:bg-card-2',
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">
                  {meta.label}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {loading ? (
                    <>
                      <Loader2 className="size-3 animate-spin" /> Loading…
                    </>
                  ) : (
                    subtitle
                  )}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
