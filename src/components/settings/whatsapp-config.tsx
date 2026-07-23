'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  AlertTriangle,
  RotateCcw,
  Plus,
  Trash2,
  Edit2,
  Star,
  Check,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';

const MASKED_TOKEN = '••••••••••••••••';

export function WhatsAppConfig() {
  const supabase = createClient();
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [configs, setConfigs] = useState<WhatsAppConfigType[]>([]);

  // Editing state (null = list view / adding new if isAdding = true)
  const [editingConfig, setEditingConfig] = useState<WhatsAppConfigType | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const [label, setLabel] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [pin, setPin] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

  const loadedAccountIdRef = useRef<string | null>(null);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  const fetchConfigs = useCallback(async (acctId: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/whatsapp/config', { method: 'GET' });
      const payload = await res.json();

      if (res.ok && Array.isArray(payload.configs)) {
        setConfigs(payload.configs);
      } else {
        // Fallback directly to Supabase client query
        const { data } = await supabase
          .from('whatsapp_config')
          .select('*')
          .eq('account_id', acctId)
          .order('sort_order', { ascending: true });
        setConfigs((data as WhatsAppConfigType[]) || []);
      }
    } catch (err) {
      console.error('fetchConfigs error:', err);
      toast.error('Failed to load WhatsApp configurations');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchConfigs(accountId);
  }, [authLoading, profileLoading, user?.id, accountId, fetchConfigs]);

  function startAdding() {
    setEditingConfig(null);
    setLabel(`WhatsApp ${configs.length + 1}`);
    setIsDefault(configs.length === 0);
    setPhoneNumberId('');
    setWabaId('');
    setAccessToken('');
    setVerifyToken('');
    setPin('');
    setTokenEdited(true);
    setIsAdding(true);
  }

  function startEditing(cfg: WhatsAppConfigType) {
    setIsAdding(false);
    setEditingConfig(cfg);
    setLabel(cfg.label || 'WhatsApp');
    setIsDefault(cfg.is_default || false);
    setPhoneNumberId(cfg.phone_number_id || '');
    setWabaId(cfg.waba_id || '');
    setAccessToken(MASKED_TOKEN);
    setVerifyToken('');
    setPin('');
    setTokenEdited(false);
  }

  function cancelEdit() {
    setIsAdding(false);
    setEditingConfig(null);
  }

  async function handleSave() {
    if (!phoneNumberId.trim()) {
      toast.error('Phone Number ID is required');
      return;
    }
    if (!editingConfig && (!accessToken.trim() || !tokenEdited)) {
      toast.error('Access Token is required for new numbers');
      return;
    }

    try {
      setSaving(true);

      const payload: Record<string, unknown> = {
        id: editingConfig?.id ?? undefined,
        label: label.trim() || 'WhatsApp',
        is_default: isDefault,
        phone_number_id: phoneNumberId.trim(),
        waba_id: wabaId.trim() || null,
        verify_token: verifyToken.trim() || null,
        pin: pin.trim() || null,
      };

      if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
        payload.access_token = accessToken.trim();
      } else if (editingConfig) {
        toast.error('Please re-enter the Access Token to update configuration');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to save configuration');
        setSaving(false);
        return;
      }

      if (data.registered === false && data.registration_error) {
        toast.error(
          `Saved, but Meta couldn't register the number: ${data.registration_error}`,
          { duration: 12000 },
        );
      } else if (data.registration_skipped) {
        toast.success(
          'Credentials saved and verified. Inbound registration was skipped (no PIN).',
          { duration: 8000 },
        );
      } else {
        toast.success(
          data.phone_info?.verified_name
            ? `Live — ${data.phone_info.verified_name} is ready for events.`
            : 'WhatsApp number saved successfully.',
        );
      }

      cancelEdit();
      if (accountId) await fetchConfigs(accountId);
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection(cfgId: string) {
    try {
      setTestingId(cfgId);
      const res = await fetch(`/api/whatsapp/config?id=${cfgId}`, { method: 'GET' });
      const payload = await res.json();

      if (payload.connected) {
        toast.success(
          payload.phone_info?.verified_name
            ? `Connected to ${payload.phone_info.verified_name}`
            : 'API connection successful'
        );
      } else {
        toast.error(payload.message || 'API connection failed');
      }
    } catch (err) {
      console.error('Test connection error:', err);
      toast.error('Connection test failed.');
    } finally {
      setTestingId(null);
    }
  }

  async function handleDelete(cfgId: string, label: string) {
    if (!confirm(`Are you sure you want to delete "${label}"? This will remove the WhatsApp connection.`)) {
      return;
    }

    try {
      setResettingId(cfgId);
      const res = await fetch(`/api/whatsapp/config?id=${cfgId}`, { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to delete configuration');
        return;
      }

      toast.success(`Deleted "${label}"`);
      if (editingConfig?.id === cfgId) {
        cancelEdit();
      }
      if (accountId) await fetchConfigs(accountId);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete configuration');
    } finally {
      setResettingId(null);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied to clipboard');
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="WhatsApp connection"
          description="Connect up to 5 WhatsApp Business phone numbers to handle different roles (Sales, Customer Support, etc.)."
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  const showForm = isAdding || editingConfig !== null;

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="WhatsApp connection"
        description="Connect up to 5 WhatsApp Business phone numbers. Each number acts as its own separate inbox."
        action={
          !showForm && configs.length < 5 ? (
            <Button onClick={startAdding} className="bg-primary hover:bg-primary/90 text-primary-foreground">
              <Plus className="size-4 mr-1" />
              Add WhatsApp Number ({configs.length}/5)
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">

          {/* List of Connected Numbers */}
          {!showForm && (
            <div className="space-y-4">
              {configs.length === 0 ? (
                <Alert className="bg-card border-border">
                  <AlertTriangle className="size-4 text-amber-400" />
                  <AlertTitle className="text-foreground">No WhatsApp numbers connected</AlertTitle>
                  <AlertDescription className="text-muted-foreground">
                    Connect your first Meta WhatsApp Business number to start receiving and sending messages.
                  </AlertDescription>
                  <Button onClick={startAdding} size="sm" className="mt-3 bg-primary text-primary-foreground">
                    <Plus className="size-4 mr-1" />
                    Connect First Number
                  </Button>
                </Alert>
              ) : (
                configs.map((cfg) => {
                  const isRegistered = Boolean(cfg.registered_at);
                  const isTesting = testingId === cfg.id;
                  const isDeleting = resettingId === cfg.id;

                  return (
                    <Card key={cfg.id} className="border-border bg-card">
                      <CardHeader className="pb-3 flex flex-row items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-foreground text-base font-semibold">{cfg.label}</CardTitle>
                            {cfg.is_default && (
                              <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] font-medium">
                                <Star className="size-3 fill-primary mr-1" /> Default Inbox
                              </Badge>
                            )}
                            <Badge
                              variant="outline"
                              className={
                                cfg.status === 'connected'
                                  ? 'border-emerald-600/50 bg-emerald-950/20 text-emerald-300 text-[10px]'
                                  : 'border-red-600/50 bg-red-950/20 text-red-300 text-[10px]'
                              }
                            >
                              {cfg.status === 'connected' ? 'Connected' : 'Disconnected'}
                            </Badge>
                          </div>
                          <CardDescription className="text-xs text-muted-foreground font-mono">
                            ID: {cfg.phone_number_id}
                          </CardDescription>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTestConnection(cfg.id)}
                            disabled={isTesting}
                            className="h-8 text-xs border-border text-muted-foreground hover:text-foreground"
                          >
                            {isTesting ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3 mr-1 text-primary" />}
                            Test
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startEditing(cfg)}
                            className="h-8 text-xs border-border text-muted-foreground hover:text-foreground"
                          >
                            <Edit2 className="size-3 mr-1" /> Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(cfg.id, cfg.label)}
                            disabled={isDeleting}
                            className="h-8 text-xs border-red-900/50 text-red-400 hover:bg-red-950/30"
                          >
                            {isDeleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0 text-xs text-muted-foreground flex items-center justify-between border-t border-border/50 mt-2 py-2">
                        <span>
                          {isRegistered
                            ? 'Webhook registered — Inbound messages active'
                            : 'Webhook not registered (enter PIN to enable inbound routing)'}
                        </span>
                        <span className="text-[11px]">
                          {cfg.connected_at ? `Linked ${new Date(cfg.connected_at).toLocaleDateString()}` : ''}
                        </span>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          )}

          {/* Add / Edit Form */}
          {showForm && (
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-foreground">
                  {isAdding ? 'Add WhatsApp Business Number' : `Edit "${editingConfig?.label}"`}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  Enter Meta API credentials for this phone number.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Inbox Label / Name</Label>
                    <Input
                      placeholder="e.g. Sales, Customer Support 1"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      className="bg-muted border-border text-foreground"
                    />
                  </div>

                  <div className="space-y-2 flex items-end">
                    <label className="flex items-center gap-2 pb-2 cursor-pointer text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={isDefault}
                        onChange={(e) => setIsDefault(e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      />
                      Set as Default Account Inbox
                    </label>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">Phone Number ID</Label>
                  <Input
                    placeholder="e.g. 100234567890123"
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                    className="bg-muted border-border text-foreground font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">WhatsApp Business Account ID (WABA ID)</Label>
                  <Input
                    placeholder="e.g. 100234567890456"
                    value={wabaId}
                    onChange={(e) => setWabaId(e.target.value)}
                    className="bg-muted border-border text-foreground font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">Permanent Access Token</Label>
                  <div className="relative">
                    <Input
                      type={showToken ? 'text' : 'password'}
                      placeholder="Enter access token"
                      value={accessToken}
                      onChange={(e) => {
                        setAccessToken(e.target.value);
                        setTokenEdited(true);
                      }}
                      onFocus={() => {
                        if (accessToken === MASKED_TOKEN) {
                          setAccessToken('');
                          setTokenEdited(true);
                        }
                      }}
                      className="bg-muted border-border text-foreground pr-10 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {editingConfig && !tokenEdited && (
                    <p className="text-xs text-muted-foreground">
                      Token is hidden for security. Re-enter it to update configuration.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">Webhook Verify Token</Label>
                  <Input
                    placeholder="Custom verify token matching Meta dashboard"
                    value={verifyToken}
                    onChange={(e) => setVerifyToken(e.target.value)}
                    className="bg-muted border-border text-foreground"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">
                    Two-step verification PIN <span className="text-muted-foreground text-xs">(optional)</span>
                  </Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6-digit PIN from Meta Manager"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="bg-muted border-border text-foreground tracking-widest font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Needed to register inbound webhooks for production numbers under a shared WABA.
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="size-4 animate-spin mr-1" />
                        Saving Number...
                      </>
                    ) : (
                      'Save Number Configuration'
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="border-border text-muted-foreground hover:bg-muted"
                  >
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Shared Webhook Callback URL */}
          <Card className="border-border bg-card">
            <CardHeader className="py-3">
              <CardTitle className="text-foreground text-sm font-semibold">Shared Webhook Callback URL</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                All connected numbers on this Meta App use this single webhook endpoint.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={webhookUrl}
                  className="bg-muted border-border text-muted-foreground font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyWebhookUrl}
                  className="shrink-0 border-border text-muted-foreground hover:text-foreground"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Instructions sidebar */}
        <div>
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-foreground text-base">Multi-Inbox Setup</CardTitle>
              <CardDescription className="text-muted-foreground">
                How multiple WhatsApp numbers work in wacrm.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs text-muted-foreground">
              <p>
                You can attach up to <strong>5 WhatsApp Business phone numbers</strong> under your Meta App to a single wacrm account.
              </p>
              <ul className="list-disc list-inside space-y-1.5 leading-relaxed">
                <li>Each number acts as an independent inbox in wacrm.</li>
                <li>Owners & Admins can view and respond across all inboxes.</li>
                <li>Agents can be assigned specific numbers in <strong>Settings → Members</strong>.</li>
                <li>Inbound messages are automatically sorted by the recipient number.</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
