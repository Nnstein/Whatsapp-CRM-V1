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
        key: 'store_id',
        label: 'Store ID',
        type: 'text',
        placeholder: 'e.g. 10042',
        helpText:
          'Your Zid Store ID. Found in your Zid merchant dashboard under API Integrations.',
        required: true,
      },
      {
        key: 'access_token',
        label: 'Access Token',
        type: 'password',
        placeholder: 'Paste your Zid Access Token…',
        helpText:
          'Your Zid Access Token. Found in your Zid merchant dashboard under API Integrations.',
        required: true,
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
