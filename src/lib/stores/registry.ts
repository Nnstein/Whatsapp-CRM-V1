/**
 * Store connector registry.
 *
 * This is the single place to add a new connector. Append a
 * `StoreConnectorMeta` object and the connector automatically
 * appears in the UI picker, the API validation, and the test
 * dispatcher — no other file needs to change.
 *
 * Logos live in /public/stores/<id>.svg.
 */

import type { StoreConnectorMeta } from './types';

export const STORE_CONNECTORS: StoreConnectorMeta[] = [
  {
    id: 'zid',
    label: 'Zid',
    description: 'Connect your Zid store to sync orders and customer data.',
    logoPath: '/stores/zid.svg',
    docsUrl: 'https://developers.zid.sa/',
    fields: [
      {
        key: 'access_token',
        label: 'Manager Token (X-Manager-Token)',
        type: 'password',
        placeholder: 'eyJpdiI6…',
        helpText:
          'Per-store Manager Token. Zid merchant dashboard → Settings → API Integrations → Generate Manager Token.',
        required: true,
      },
      {
        key: 'authorization_token',
        label: 'Authorization Token',
        type: 'password',
        placeholder: 'eyJ0eXAi…',
        helpText:
          'App-level JWT from the Zid OAuth flow (install a private app from the Zid Partner Dashboard on your store). Zid requires BOTH tokens — they are different values, not interchangeable.',
        required: true,
      },
      {
        key: 'store_id',
        label: 'Store ID',
        type: 'text',
        placeholder: 'e.g. 10042',
        helpText:
          'Optional — the Manager Token already scopes your store. Sent as the Store-Id header when provided.',
        required: false,
      },
    ],
  },
  // ── Add future connectors here ────────────────────────────────
  // {
  //   id: 'shopify',
  //   label: 'Shopify',
  //   description: 'Connect your Shopify store.',
  //   logoPath: '/stores/shopify.svg',
  //   fields: [
  //     { key: 'store_domain', label: 'Store domain', type: 'url', required: true },
  //     { key: 'access_token', label: 'Access token', type: 'password', required: true },
  //   ],
  // },
];

/** Fast lookup by connector ID. Returns undefined for unknown types. */
export function getConnectorMeta(id: string): StoreConnectorMeta | undefined {
  return STORE_CONNECTORS.find((c) => c.id === id);
}

/** All registered connector IDs — used for API-side input validation. */
export const CONNECTOR_IDS = STORE_CONNECTORS.map((c) => c.id);
