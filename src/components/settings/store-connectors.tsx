'use client';

import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  ShoppingBag,
  Trash2,
  Unplug,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { STORE_CONNECTORS } from '@/lib/stores/registry';
import type { StoreConnectorMeta, StoreConnection } from '@/lib/stores/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { SettingsPanelHead } from './settings-panel-head';

// ── Types ────────────────────────────────────────────────────────

interface ApiConnection extends StoreConnection {
  has_credentials: boolean;
}

// ── Connector picker card ────────────────────────────────────────

function ConnectorCard({
  connector,
  connection,
  onSelect,
}: {
  connector: StoreConnectorMeta;
  connection: ApiConnection | undefined;
  onSelect: () => void;
}) {
  const isConnected = !!connection && connection.last_test_status === 'ok';
  const isSaved = !!connection;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative flex w-full items-start gap-4 rounded-xl border border-border bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      id={`connector-card-${connector.id}`}
    >
      {/* Logo placeholder / icon */}
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <ShoppingBag className="size-6" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{connector.label}</span>
          {isConnected && (
            <Badge
              variant="secondary"
              className="gap-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
            >
              <Wifi className="size-3" />
              Connected
            </Badge>
          )}
          {isSaved && !isConnected && (
            <Badge variant="secondary" className="gap-1 text-amber-700 dark:text-amber-400">
              <WifiOff className="size-3" />
              {connection.last_test_status === 'error' ? 'Error' : 'Saved'}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{connector.description}</p>
        {connection?.store_label && (
          <p className="mt-1 text-xs font-medium text-foreground">{connection.store_label}</p>
        )}
        {connection?.last_tested_at && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Last tested {format(new Date(connection.last_tested_at), 'MMM d, HH:mm')}
          </p>
        )}
      </div>

      <ChevronRight className="size-4 shrink-0 self-center text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

// ── Connector form ───────────────────────────────────────────────

function ConnectorForm({
  connector,
  connection,
  canEdit,
  onBack,
  onSaved,
  onRemoved,
}: {
  connector: StoreConnectorMeta;
  connection: ApiConnection | undefined;
  canEdit: boolean;
  onBack: () => void;
  onSaved: (connection: ApiConnection) => void;
  onRemoved: () => void;
}) {
  // One state entry per field — keyed by field.key.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const field of connector.fields) init[field.key] = '';
    return init;
  });
  const [showField, setShowField] = useState<Record<string, boolean>>({});
  const [edited, setEdited] = useState<Record<string, boolean>>({});

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    storeName?: string;
    error?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const isSaved = !!connection;
  const MASKED = '••••••••••••••••';

  function setValue(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setEdited((prev) => ({ ...prev, [key]: true }));
    setTestResult(null);
  }

  function toggleShow(key: string) {
    setShowField((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function getDisplayValue(field: (typeof connector.fields)[number]) {
    if (isSaved && !edited[field.key] && field.type === 'password') return MASKED;
    return values[field.key];
  }

  function hasChanges() {
    return connector.fields.some((f) => edited[f.key] && values[f.key].trim() !== '');
  }

  function buildCredentials() {
    const creds: Record<string, string> = {};
    for (const field of connector.fields) {
      const val = values[field.key].trim();
      // Only include edited fields (to avoid sending back masked placeholders)
      if (edited[field.key]) creds[field.key] = val;
    }
    return creds;
  }

  async function handleTest() {
    // Require all required fields to have a value (either freshly typed or already saved).
    for (const field of connector.fields) {
      if (field.required) {
        const val = values[field.key].trim();
        const isSavedField = isSaved && !edited[field.key];
        if (!isSavedField && !val) {
          toast.error(`Please enter your ${field.label} before testing.`);
          return;
        }
      }
    }

    setTesting(true);
    setTestResult(null);

    try {
      const body: Record<string, unknown> = {
        connector_type: connector.id,
        credentials: buildCredentials(),
      };

      // If some fields are not edited but saved, we need to send a special
      // signal so the server uses the stored credentials. We achieve this
      // by sending an empty object for unedited fields; the server will
      // skip validation for fields not present in the payload and use the
      // saved row (future enhancement). For now, require users to re-enter
      // all fields when testing an already-saved connector.
      if (isSaved && !hasChanges()) {
        // Re-test the saved credentials — POST with no credentials triggers
        // the server to fetch and test the stored encrypted values.
        const res = await fetch('/api/stores/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connector_type: connector.id, use_saved: true }),
        });
        const data = await res.json();
        setTestResult(data);
        if (data.ok) toast.success('Connection successful!');
        else toast.error(`Connection failed: ${data.error}`);
        return;
      }

      const res = await fetch('/api/stores/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      setTestResult(data);
      if (data.ok) {
        toast.success(data.storeName ? `Connected to "${data.storeName}"!` : 'Connection successful!');
      } else {
        toast.error(`Connection failed: ${data.error}`);
      }
    } catch {
      const err = { ok: false, error: 'Unexpected error — check your network connection.' };
      setTestResult(err);
      toast.error(err.error);
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    // Validate required fields.
    for (const field of connector.fields) {
      if (field.required) {
        const val = values[field.key].trim();
        const isSavedField = isSaved && !edited[field.key];
        if (!isSavedField && !val) {
          toast.error(`Please enter your ${field.label}.`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      const creds: Record<string, string> = {};
      for (const field of connector.fields) {
        const val = values[field.key].trim();
        if (val && val !== MASKED) creds[field.key] = val;
      }

      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connector_type: connector.id, credentials: creds }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save connection');
        return;
      }

      toast.success(`${connector.label} connection saved`);
      setEdited({});
      setTestResult(null);
      onSaved(data.connection as ApiConnection);
    } catch {
      toast.error('Unexpected error saving connection');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm(`Remove the ${connector.label} connection? This cannot be undone.`)) return;

    setRemoving(true);
    try {
      const res = await fetch('/api/stores', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connector_type: connector.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to remove connection');
        return;
      }
      toast.success(`${connector.label} disconnected`);
      onRemoved();
    } catch {
      toast.error('Unexpected error removing connection');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className="size-4 rotate-180" />
        All connectors
      </button>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <ShoppingBag className="size-5" />
            </div>
            <div>
              <CardTitle className="text-base">{connector.label}</CardTitle>
              <CardDescription className="mt-0.5">{connector.description}</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Saved status */}
          {isSaved && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
              {connection.last_test_status === 'ok' ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
              ) : connection.last_test_status === 'error' ? (
                <AlertCircle className="size-4 shrink-0 text-amber-500" />
              ) : (
                <Unplug className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="text-muted-foreground">
                {connection.last_test_status === 'ok'
                  ? `Connected${connection.store_label ? ` · ${connection.store_label}` : ''}`
                  : connection.last_test_status === 'error'
                    ? `Last test failed · ${connection.last_test_error ?? 'Unknown error'}`
                    : 'Saved — not yet tested'}
              </span>
              {connection.last_tested_at && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {format(new Date(connection.last_tested_at), 'MMM d, HH:mm')}
                </span>
              )}
            </div>
          )}

          <Separator />

          {/* Credential fields */}
          <div className="space-y-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Credentials
            </p>
            {connector.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`field-${field.key}`}>{field.label}</Label>
                <div className="relative">
                  <Input
                    id={`field-${field.key}`}
                    type={
                      field.type === 'password' && !showField[field.key] ? 'password' : 'text'
                    }
                    placeholder={
                      isSaved && !edited[field.key] ? 'Saved — enter to replace' : field.placeholder
                    }
                    value={getDisplayValue(field)}
                    onChange={(e) => setValue(field.key, e.target.value)}
                    disabled={!canEdit}
                    className="pr-10"
                    autoComplete="off"
                    data-1p-ignore
                  />
                  {field.type === 'password' && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => toggleShow(field.key)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showField[field.key] ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  )}
                </div>
                {field.helpText && (
                  <p className="text-xs text-muted-foreground">{field.helpText}</p>
                )}
              </div>
            ))}
          </div>

          {connector.docsUrl && (
            <p className="text-xs text-muted-foreground">
              Need help finding your credentials?{' '}
              <a
                href={connector.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:no-underline"
              >
                {connector.label} Developer Docs ↗
              </a>
            </p>
          )}

          {/* Test result inline */}
          {testResult && (
            <div
              className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${
                testResult.ok
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
              )}
              <span>
                {testResult.ok
                  ? `Connection successful${testResult.storeName ? ` · Store: ${testResult.storeName}` : ''}`
                  : testResult.error}
              </span>
            </div>
          )}

          {/* Action row */}
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing || saving}
                id={`test-${connector.id}-connection`}
              >
                {testing ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Wifi className="mr-1.5 size-3.5" />
                )}
                Test connection
              </Button>

              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={saving || testing}
                id={`save-${connector.id}-connection`}
              >
                {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                {isSaved ? 'Update' : 'Save connection'}
              </Button>

              {isSaved && connection && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    setTesting(true);
                    try {
                      const res = await fetch(`/api/stores/${connection.id}/sync`, { method: 'POST' });
                      const data = await res.json();
                      if (res.ok) {
                        toast.success(`Successfully synced ${data.synced_count} products from ${connector.label}!`);
                      } else {
                        toast.error(data.error || 'Catalog sync failed');
                      }
                    } catch {
                      toast.error('Catalog sync failed');
                    } finally {
                      setTesting(false);
                    }
                  }}
                  disabled={testing || saving}
                >
                  <ShoppingBag className="mr-1.5 size-3.5" />
                  Sync Products
                </Button>
              )}

              {isSaved && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleRemove}
                  disabled={removing}
                  className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                  id={`remove-${connector.id}-connection`}
                >
                  {removing ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1.5 size-3.5" />
                  )}
                  Disconnect
                </Button>
              )}
            </div>
          )}

          {/* Webhook URL — shown after saving so the merchant can copy it into their store */}
          {isSaved && connection.webhook_secret && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Order Webhook URL
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Paste this URL into your {connector.label} store&rsquo;s webhook settings.
                  Orders will auto-confirm matching carts in your CRM.
                </p>
                <div
                  className="mt-1 font-mono text-[11px] bg-muted p-2 rounded border overflow-x-auto select-all cursor-text break-all"
                  title="Click to select all"
                >
                  {typeof window !== 'undefined'
                    ? `${window.location.origin}/api/v1/webhooks/stores/${connector.id}?token=${connection.webhook_secret}`
                    : `/api/v1/webhooks/stores/${connector.id}?token=${connection.webhook_secret}`}
                </div>
                <button
                  type="button"
                  className="text-[11px] text-primary hover:underline"
                  onClick={() => {
                    const url = typeof window !== 'undefined'
                      ? `${window.location.origin}/api/v1/webhooks/stores/${connector.id}?token=${connection.webhook_secret}`
                      : '';
                    if (url) navigator.clipboard.writeText(url);
                  }}
                >
                  Copy webhook URL
                </button>
              </div>
            </>
          )}

          {!canEdit && (
            <p className="text-xs text-muted-foreground">
              Only admins and owners can manage store connections.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────

export function StoreConnectors() {
  const { accountRole, defaultCurrency } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<ApiConnection[]>([]);
  const [activeConnector, setActiveConnector] = useState<StoreConnectorMeta | null>(null);
  const [sendingTestWebhook, setSendingTestWebhook] = useState(false);
  const [testPhone, setTestPhone] = useState('+966501234567');
  const [testOrderId, setTestOrderId] = useState('10042');
  const [testStatus, setTestStatus] = useState('paid');
  const [testTotal, setTestTotal] = useState('199.00');
  const [testCurrency, setTestCurrency] = useState(defaultCurrency || 'SAR');
  const [testResultJson, setTestResultJson] = useState<string | null>(null);

  useEffect(() => {
    if (defaultCurrency) {
      setTestCurrency(defaultCurrency);
    }
  }, [defaultCurrency]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stores');
      if (res.ok) {
        const data = await res.json();
        setConnections(data.connections ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function getConnection(connectorId: string) {
    return connections.find((c) => c.connector_type === connectorId);
  }

  if (activeConnector) {
    return (
      <ConnectorForm
        connector={activeConnector}
        connection={getConnection(activeConnector.id)}
        canEdit={canEdit}
        onBack={() => setActiveConnector(null)}
        onSaved={(conn) => {
          setConnections((prev) => {
            const idx = prev.findIndex((c) => c.connector_type === conn.connector_type);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = conn;
              return next;
            }
            return [...prev, conn];
          });
          setActiveConnector(null);
        }}
        onRemoved={() => {
          setConnections((prev) =>
            prev.filter((c) => c.connector_type !== activeConnector.id),
          );
          setActiveConnector(null);
        }}
      />
    );
  }

  const connectedCount = connections.filter((c) => c.last_test_status === 'ok').length;

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title="Store connectors"
        description="Connect an e-commerce store to enrich contacts with order history and customer data."
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <>
          {connectedCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {connectedCount} store{connectedCount !== 1 ? 's' : ''} connected
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {STORE_CONNECTORS.map((connector) => (
              <ConnectorCard
                key={connector.id}
                connector={connector}
                connection={getConnection(connector.id)}
                onSelect={() => setActiveConnector(connector)}
              />
            ))}
          </div>

          {/* Universal Webhook Card for Custom / Any Store */}
          <Card className="mt-6 border-dashed">
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ShoppingBag className="size-4 text-primary" />
                Universal Webhook (Custom Store / WooCommerce / Wix)
              </CardTitle>
              <CardDescription className="text-xs">
                Have a custom e-commerce store or platform without a built-in connector? Send order notifications directly to your CRM webhook endpoint.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              {/* Webhook URL — shows the token-scoped URL if the generic connection exists */}
              {(() => {
                const genericConn = connections.find((c) => c.connector_type === 'generic');
                const webhookUrl = genericConn?.webhook_secret
                  ? (typeof window !== 'undefined'
                      ? `${window.location.origin}/api/v1/webhooks/stores/generic?token=${genericConn.webhook_secret}`
                      : `/api/v1/webhooks/stores/generic?token=${genericConn.webhook_secret}`)
                  : null;
                return (
                  <div>
                    <Label className="text-muted-foreground text-[11px]">Universal Webhook URL</Label>
                    {webhookUrl ? (
                      <>
                        <div className="mt-1 font-mono text-xs bg-muted p-2 rounded border overflow-x-auto select-all break-all">
                          {webhookUrl}
                        </div>
                        <button
                          type="button"
                          className="mt-1 text-[11px] text-primary hover:underline"
                          onClick={() => navigator.clipboard.writeText(webhookUrl)}
                        >
                          Copy webhook URL
                        </button>
                      </>
                    ) : (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Your secure webhook URL will appear here after you save a Generic / Custom Store connection above.
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Interactive Test Form */}
              <div className="pt-2 space-y-3 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground text-xs">Test Webhook Builder</span>
                  <span className="text-[10px] text-muted-foreground">Enter a customer's phone number to test cart auto-confirmation</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Order ID</Label>
                    <Input
                      size={1}
                      className="h-8 text-xs font-mono"
                      value={testOrderId}
                      onChange={(e) => setTestOrderId(e.target.value)}
                      placeholder="10042"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Customer Phone</Label>
                    <Input
                      size={1}
                      className="h-8 text-xs font-mono"
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      placeholder="+966501234567"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Status</Label>
                    <select
                      className="w-full h-8 rounded border border-border bg-muted px-2 text-xs outline-none"
                      value={testStatus}
                      onChange={(e) => setTestStatus(e.target.value)}
                    >
                      <option value="paid">paid</option>
                      <option value="pending">pending</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Total</Label>
                    <Input
                      size={1}
                      className="h-8 text-xs font-mono"
                      value={testTotal}
                      onChange={(e) => setTestTotal(e.target.value)}
                      placeholder="199.00"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Currency</Label>
                    <Input
                      size={1}
                      className="h-8 text-xs font-mono"
                      value={testCurrency}
                      onChange={(e) => setTestCurrency(e.target.value.toUpperCase())}
                      placeholder={defaultCurrency || 'SAR'}
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-muted-foreground text-[10px]">JSON Payload Preview</Label>
                  <pre className="mt-1 font-mono text-[11px] bg-muted/80 p-2 rounded border text-foreground overflow-x-auto">
{JSON.stringify(
  {
    order_id: testOrderId || '10042',
    customer_phone: testPhone || '+966501234567',
    status: testStatus,
    total: parseFloat(testTotal) || 0,
    currency: testCurrency || defaultCurrency || 'SAR',
  },
  null,
  2
)}
                  </pre>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={sendingTestWebhook}
                    onClick={async () => {
                      setSendingTestWebhook(true);
                      setTestResultJson(null);
                      try {
                        const payload = {
                          order_id: testOrderId.trim() || '10042',
                          customer_phone: testPhone.trim() || '+966501234567',
                          status: testStatus,
                          total: parseFloat(testTotal) || 0,
                          currency: testCurrency.trim() || defaultCurrency || 'SAR',
                        };

                        const genericConn = connections.find((c) => c.connector_type === 'generic');
                        const webhookEndpoint = genericConn?.webhook_secret
                          ? `/api/v1/webhooks/stores/generic?token=${genericConn.webhook_secret}`
                          : '/api/v1/webhooks/stores/generic';

                        const res = await fetch(webhookEndpoint, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(payload),
                        });

                        const data = await res.json();
                        setTestResultJson(JSON.stringify(data, null, 2));

                        if (res.ok && data.received) {
                          if (data.cart_confirmed) {
                            toast.success(`✓ Success! Active cart auto-confirmed for order #${data.order_id}!`);
                          } else if (data.processed) {
                            toast.success(`Webhook received for order #${data.order_id}`);
                          } else {
                            toast.info(`Webhook received! (${data.reason || 'No cart matched'})`);
                          }
                        } else {
                          toast.error(data.error || 'Test webhook failed');
                        }
                      } catch (err: any) {
                        toast.error(err.message || 'Failed to send test webhook');
                      } finally {
                        setSendingTestWebhook(false);
                      }
                    }}
                    className="gap-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {sendingTestWebhook ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Wifi className="size-3.5" />
                    )}
                    Send Test Webhook
                  </Button>
                </div>

                {/* Server Response Inspector */}
                {testResultJson && (
                  <div className="mt-3 p-3 rounded-lg border bg-card space-y-1 animate-in fade-in-50">
                    <p className="text-[11px] font-semibold text-foreground flex items-center justify-between">
                      <span>Server Response Output:</span>
                      <span className="text-[10px] text-muted-foreground font-mono">HTTP 200 OK</span>
                    </p>
                    <pre className="font-mono text-[11px] bg-muted p-2 rounded text-emerald-600 dark:text-emerald-400 overflow-x-auto">
                      {testResultJson}
                    </pre>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {STORE_CONNECTORS.length === 0 && (
            <p className="text-sm text-muted-foreground">No connectors available yet.</p>
          )}
        </>
      )}
    </div>
  );
}
