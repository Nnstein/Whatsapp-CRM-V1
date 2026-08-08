'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Building2, ChevronRight, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { THEMES } from '@/lib/themes';
import { CURRENCIES, DEFAULT_CURRENCY } from '@/lib/currency';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import { canAccessSettingsSection } from '@/lib/auth/roles';
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

const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2 MB
const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function WorkspaceBrandingCard() {
  const { account, refreshProfile, canEditSettings } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(account?.name ?? '');
  const [logoUrl, setLogoUrl] = useState(account?.logo_url ?? null);
  const [pendingLogo, setPendingLogo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Sync local state when account resolves / refreshes.
  useEffect(() => {
    if (!account) return;
    setName(account.name);
    setLogoUrl(account.logo_url ?? null);
  }, [account?.name, account?.logo_url]);

  const hasChanges =
    name.trim() !== (account?.name ?? '').trim() ||
    pendingLogo !== null ||
    logoUrl !== (account?.logo_url ?? null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      toast.error('Logo must be PNG, JPEG, WebP, or GIF');
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      toast.error('Logo must be 2 MB or smaller');
      return;
    }

    setPendingLogo(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  }

  function removeLogo() {
    setPendingLogo(null);
    setPreviewUrl(null);
    setLogoUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSave() {
    if (!account) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Business name cannot be empty');
      return;
    }

    setSaving(true);
    try {
      let nextLogoUrl = logoUrl;

      if (pendingLogo) {
        const supabase = createClient();
        const ext = pendingLogo.name.split('.').pop()?.toLowerCase() || 'png';
        const path = `${account.id}/logo-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('logos')
          .upload(path, pendingLogo, {
            cacheControl: '3600',
            upsert: true,
            contentType: pendingLogo.type,
          });
        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }
        const {
          data: { publicUrl },
        } = supabase.storage.from('logos').getPublicUrl(path);
        nextLogoUrl = publicUrl;
      }

      const body: Record<string, unknown> = { name: trimmedName };
      if (logoUrl !== (account.logo_url ?? null) || pendingLogo) {
        body.logo_url = nextLogoUrl;
      }

      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to save branding');
      }

      toast.success('Workspace branding saved');
      setPendingLogo(null);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      await refreshProfile();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save branding');
    } finally {
      setSaving(false);
    }
  }

  const currentPreview = previewUrl ?? logoUrl ?? null;

  return (
    <Card className="mt-6 p-5">
      <div className="flex items-center gap-2 text-base font-semibold text-foreground">
        <Building2 className="h-4 w-4 text-primary" />
        Workspace branding
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Personalize the sidebar with your business name and logo.
      </p>

      <div className="mt-4 grid gap-5 sm:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-start gap-2">
          <Label className="text-xs text-muted-foreground">Logo</Label>
          <div className="relative">
            {currentPreview ? (
              <div className="group relative h-20 w-20 overflow-hidden rounded-lg border border-border">
                <img
                  src={currentPreview}
                  alt="Business logo preview"
                  className="h-full w-full object-cover"
                />
                {canEditSettings && (
                  <button
                    type="button"
                    onClick={removeLogo}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="Remove logo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-border bg-muted">
                <Building2 className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
          </div>
          {canEditSettings && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_LOGO_TYPES.join(',')}
                onChange={handleFileChange}
                className="hidden"
                aria-label="Upload business logo"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Upload logo
              </Button>
              <p className="text-xs text-muted-foreground">PNG, JPEG, WebP or GIF · max 2 MB</p>
            </>
          )}
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Business name</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEditSettings || saving}
              placeholder="Acme Inc."
            />
            <p className="text-xs text-muted-foreground">
              Shown in the sidebar and in team invitations.
            </p>
          </div>

          {canEditSettings && (
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={handleSave}
                disabled={!hasChanges || saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save branding'
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
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
    const acctId = accountId;

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
      const [row, health] = await Promise.allSettled([
        supabase
          .from('whatsapp_config')
          .select('phone_number_id')
          .eq('account_id', acctId)
          .limit(1)
          .maybeSingle(),
        fetch('/api/whatsapp/config', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      if (cancelled) return;
      setWhatsapp({
        configured: row.status === 'fulfilled' && !!row.value.data?.phone_number_id,
        connected: health.status === 'fulfilled' && !!health.value?.connected,
      });
      setWhatsappLoading(false);
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

  const rawTiles: {
    section: SettingsSection;
    loading: boolean;
    subtitle: ReactNode;
  }[] = [
    {
      section: 'profile',
      loading: false,
      subtitle: 'Manage your name, avatar & email',
    },
    {
      section: 'security',
      loading: false,
      subtitle: 'Password, sessions & account security',
    },
    {
      section: 'appearance',
      loading: false,
      subtitle: `${cap(mode)} mode · ${themeName} accent`,
    },
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
      section: 'api',
      loading: false,
      subtitle: 'Manage account API keys for external integrations',
    },
    {
      section: 'stores',
      loading: false,
      subtitle: 'Connect e-commerce stores (Zid, Shopify, …)',
    },
  ];

  const tiles = rawTiles.filter((t) =>
    !accountRole ? true : canAccessSettingsSection(accountRole, t.section),
  );

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

      {/* Workspace branding — editable by admins, visible to everyone. */}
      <WorkspaceBrandingCard />

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
