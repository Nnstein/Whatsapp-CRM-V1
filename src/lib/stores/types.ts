/**
 * Store connector types.
 *
 * `StoreConnectorMeta` describes a connector in the registry — its
 * display properties and the credential fields the UI should render.
 * Adding a new connector = appending one object to registry.ts; no
 * other file needs to change for it to appear in the UI.
 */

export type ConnectorFieldType = 'text' | 'password' | 'url';

export interface ConnectorField {
  /** Key used in the credentials JSON object (e.g. 'auth_token'). */
  key: string;
  label: string;
  type: ConnectorFieldType;
  placeholder?: string;
  helpText?: string;
  required: boolean;
}

export interface StoreConnectorMeta {
  /** Stable identifier — stored in `store_connections.connector_type`. */
  id: string;
  label: string;
  /** Short tagline shown in the connector picker grid. */
  description: string;
  /** Absolute path to the SVG logo in /public, e.g. '/stores/zid.svg'. */
  logoPath: string;
  /** Link to the connector's credential setup docs. */
  docsUrl?: string;
  /** Form fields required to establish a connection. */
  fields: ConnectorField[];
}

/** A saved store connection row (credentials are never returned raw). */
export interface StoreConnection {
  id: string;
  account_id: string;
  connector_type: string;
  /** Human-readable store name from the last successful test. */
  store_label: string | null;
  is_active: boolean;
  last_tested_at: string | null;
  last_test_status: 'ok' | 'error' | null;
  last_test_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Result returned by every connector's `testConnection()`. */
export interface TestConnectionResult {
  ok: boolean;
  /** Store name / display label on success. */
  storeName?: string;
  /** Human-readable error message on failure. */
  error?: string;
}
