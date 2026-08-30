/**
 * Payment gateway connector types.
 *
 * Mirrors the store connector type system (`src/lib/stores/types.ts`).
 * Adding a new gateway = append one `PaymentConnectorMeta` to registry.ts.
 */

export interface ConnectorField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  placeholder?: string;
  description?: string;
  helpText?: string;
  required?: boolean;
}

export interface PaymentConnectorMeta {
  /** Stable identifier — stored in `payment_connections.connector_type`. */
  id: string;
  label: string;
  /** Short tagline shown in the connector picker grid. */
  description: string;
  /** Absolute path to the SVG logo in /public, e.g. '/payments/myfatoorah.svg'. */
  logoPath: string;
  /** Link to the gateway's credential setup docs. */
  docsUrl?: string;
  /** Form fields required to establish a connection. */
  fields: ConnectorField[];
}

/** A saved payment connection row (credentials are never returned raw). */
export interface PaymentConnection {
  id: string;
  account_id: string;
  connector_type: string;
  /** Human-readable gateway name from the last successful test. */
  gateway_label: string | null;
  is_active: boolean;
  last_tested_at: string | null;
  last_test_status: 'ok' | 'error' | null;
  last_test_error: string | null;
  /**
   * Stable random token (32 hex chars) embedded in the CallBackUrl so
   * MyFatoorah's redirect can be resolved to this account+connection.
   * Safe to show in UI — it's a URL token, not a private API secret.
   */
  webhook_secret: string | null;
  created_at: string;
  updated_at: string;
}

/** Result returned by every gateway's `testConnection()`. */
export interface TestPaymentResult {
  ok: boolean;
  /** Gateway / account name on success. */
  gatewayName?: string;
  /** Human-readable error message on failure. */
  error?: string;
}

/** Input to `createPaymentLink()`. */
export interface CreatePaymentLinkRequest {
  amount: number;
  currency: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  /** Reference sent to the gateway (used to look up the invoice on callback). */
  customerReference?: string;
  items?: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  /** Where the gateway should redirect the customer's browser on success. */
  callbackUrl: string;
  /** Where the gateway should redirect the customer's browser on failure. */
  errorUrl: string;
}

/** Return value from `createPaymentLink()`. */
export interface CreatePaymentLinkResult {
  /** Gateway-side invoice identifier (e.g. MyFatoorah InvoiceId). */
  invoiceId: string;
  /** The URL to send to the customer via WhatsApp. */
  invoiceUrl: string;
}
