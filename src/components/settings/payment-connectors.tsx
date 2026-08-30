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
  CreditCard,
  Eye,
  EyeOff,
  Loader2,
  Trash2,
  Unplug,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { PAYMENT_CONNECTORS } from '@/lib/payments/registry';
import type { PaymentConnectorMeta, PaymentConnection } from '@/lib/payments/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { SettingsPanelHead } from './settings-panel-head';

// ── Types ────────────────────────────────────────────────────────

interface ApiPaymentConnection extends PaymentConnection {
  has_credentials: boolean;
}

// ── Connector picker card ────────────────────────────────────────

function PaymentConnectorCard({
  connector,
  connection,
  onSelect,
}: {
  connector: PaymentConnectorMeta;
  connection: ApiPaymentConnection | undefined;
  onSelect: () => void;
}) {
  const isConnected = !!connection && connection.last_test_status === 'ok';
  const isSaved = !!connection;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative flex w-full items-start gap-4 rounded-xl border border-border bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      id={`payment-connector-card-${connector.id}`}
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <CreditCard className="size-6 text-primary" />
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
        {connection?.gateway_label && (
          <p className="mt-1 text-xs font-medium text-foreground">{connection.gateway_label}</p>
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

function PaymentConnectorForm({
  connector,
  connection,
  canEdit,
  onBack,
  onSaved,
  onRemoved,
}: {
  connector: PaymentConnectorMeta;
  connection: ApiPaymentConnection | undefined;
  canEdit: boolean;
  onBack: () => void;
  onSaved: (connection: ApiPaymentConnection) => void;
  onRemoved: () => void;
}) {
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
    gatewayName?: string;
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
      if (edited[field.key]) creds[field.key] = val;
    }
    return creds;
  }

  async function handleTest() {
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
      if (isSaved && !hasChanges()) {
        const res = await fetch('/api/payments/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connector_type: connector.id, use_saved: true }),
        });
        const data = await res.json();
        setTestResult(data);
        if (data.ok) toast.success('Payment gateway connection successful!');
        else toast.error(`Connection failed: ${data.error}`);
        return;
      }

      const res = await fetch('/api/payments/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connector_type: connector.id,
          credentials: buildCredentials(),
        }),
      });

      const data = await res.json();
      setTestResult(data);
      if (data.ok) {
        toast.success(
          data.gatewayName
            ? `Connected to "${data.gatewayName}"!`
            : 'Payment gateway connection successful!',
        );
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

      const res = await fetch('/api/payments', {
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
      onSaved(data.connection as ApiPaymentConnection);
    } catch {
      toast.error('Unexpected error saving connection');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm(`Remove the ${connector.label} gateway connection? This cannot be undone.`))
      return;

    setRemoving(true);
    try {
      const res = await fetch('/api/payments', {
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

  const effectiveOrigin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://whatsapp-crm-v1.onrender.com';

  const webhookUrl = connection?.webhook_secret
    ? `${effectiveOrigin}/api/v1/webhooks/payments/${connector.id}/callback?token=${connection.webhook_secret}`
    : null;

  return (
    <div className="space-y-6" id={`payment-connector-form-${connector.id}`}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          ← All payment gateways
        </button>

        {isSaved && canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={removing}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
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

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base">{connector.label} Credentials</CardTitle>
              <CardDescription className="mt-1 text-xs">
                {connector.description}
                {connector.docsUrl && (
                  <>
                    {' '}
                    <a
                      href={connector.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                    >
                      View setup guide ↗
                    </a>
                  </>
                )}
              </CardDescription>
            </div>
            {isSaved && (
              <Badge
                variant="secondary"
                className={
                  connection.last_test_status === 'ok'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }
              >
                {connection.last_test_status === 'ok' ? 'Connected' : 'Saved'}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {connector.fields.map((field) => {
            const isPassword = field.type === 'password';
            const isShown = !!showField[field.key];
            const inputType = isPassword ? (isShown ? 'text' : 'password') : 'text';

            return (
              <div key={field.key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`field-${field.key}`} className="text-xs font-medium">
                    {field.label}
                    {field.required && <span className="ml-0.5 text-destructive">*</span>}
                  </Label>
                  {isPassword && isSaved && !edited[field.key] && (
                    <span className="text-[11px] text-muted-foreground">Saved (encrypted)</span>
                  )}
                </div>

                <div className="relative">
                  <Input
                    id={`field-${field.key}`}
                    type={inputType}
                    value={getDisplayValue(field)}
                    onChange={(e) => setValue(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    disabled={!canEdit}
                    className={`font-mono text-xs ${isPassword ? 'pr-9' : ''}`}
                    autoComplete="off"
                  />
                  {isPassword && (
                    <button
                      type="button"
                      onClick={() => toggleShow(field.key)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                      title={isShown ? 'Hide' : 'Show'}
                    >
                      {isShown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  )}
                </div>

                {field.helpText && (
                  <p className="text-[11px] text-muted-foreground">{field.helpText}</p>
                )}
              </div>
            );
          })}

          {testResult && (
            <div
              className={`flex items-start gap-2.5 rounded-lg border p-3 text-xs ${
                testResult.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : 'border-destructive/30 bg-destructive/5 text-destructive'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertCircle className="size-4 shrink-0 text-destructive" />
              )}
              <div className="space-y-0.5">
                <p className="font-semibold">
                  {testResult.ok ? 'Connection verified' : 'Connection failed'}
                </p>
                <p className="text-[11px] leading-relaxed">
                  {testResult.ok
                    ? testResult.gatewayName
                      ? `Successfully authenticated with ${testResult.gatewayName}.`
                      : 'Credentials verified and active.'
                    : testResult.error}
                </p>
              </div>
            </div>
          )}

          {isSaved && webhookUrl && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Payment Callback URL</Label>
                <p className="text-[11px] text-muted-foreground">
                  MyFatoorah automatically receives this callback URL when the in-chat checkout link
                  is created. You can also configure it in MyFatoorah Portal → Webhook Settings.
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={webhookUrl}
                    className="font-mono text-xs bg-muted text-muted-foreground"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(webhookUrl);
                      toast.success('Callback URL copied to clipboard');
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            </>
          )}

          {canEdit && (
            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing || saving}
                className="text-xs"
              >
                {testing ? (
                  <>
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    Testing…
                  </>
                ) : (
                  <>
                    <Wifi className="mr-1.5 size-3.5" />
                    Test connection
                  </>
                )}
              </Button>

              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={saving || testing}
                className="text-xs"
              >
                {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                {isSaved ? 'Update connection' : 'Save connection'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────

export function PaymentConnectorsSettings() {
  const { canEditSettings: canEdit } = useAuth();

  const [connections, setConnections] = useState<ApiPaymentConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch('/api/payments');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setConnections(data.connections ?? []);
    } catch {
      toast.error('Failed to load payment connections');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const selectedConnector = PAYMENT_CONNECTORS.find((c) => c.id === selectedConnectorId);
  const selectedConnection = connections.find((c) => c.connector_type === selectedConnectorId);

  return (
    <div className="space-y-6" id="settings-payment-connectors-panel">
      <SettingsPanelHead
        title="In-Chat Payment Gateways"
        description="Connect regional payment gateways (MyFatoorah, Hesabe, etc.) to generate direct, secure checkout links inside customer WhatsApp conversations."
      />

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : selectedConnector ? (
        <PaymentConnectorForm
          connector={selectedConnector}
          connection={selectedConnection}
          canEdit={canEdit}
          onBack={() => setSelectedConnectorId(null)}
          onSaved={(savedConn) => {
            setConnections((prev) => [
              ...prev.filter((c) => c.connector_type !== savedConn.connector_type),
              savedConn,
            ]);
          }}
          onRemoved={() => {
            setConnections((prev) =>
              prev.filter((c) => c.connector_type !== selectedConnector.id),
            );
            setSelectedConnectorId(null);
          }}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {PAYMENT_CONNECTORS.map((connector) => (
              <PaymentConnectorCard
                key={connector.id}
                connector={connector}
                connection={connections.find((c) => c.connector_type === connector.id)}
                onSelect={() => setSelectedConnectorId(connector.id)}
              />
            ))}
          </div>

          <Card className="border-dashed bg-muted/30">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CreditCard className="size-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold">How in-chat payment works</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    When a customer is checking out on WhatsApp, the CRM automatically generates a
                    live payment link (KNET, Apple Pay, Visa/Mastercard) via your connected gateway.
                    Once the customer completes payment, the cart is confirmed and a receipt is sent
                    back to the WhatsApp conversation automatically.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
