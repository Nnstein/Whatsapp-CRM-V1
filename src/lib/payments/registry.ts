/**
 * Payment gateway connector registry.
 *
 * The single place to add a new gateway. Append a `PaymentConnectorMeta`
 * and the connector automatically appears in the UI picker, API validation,
 * and test dispatcher — no other file needs to change.
 *
 * Logos live in /public/payments/<id>.svg.
 */

import type { PaymentConnectorMeta } from './types';

export const PAYMENT_CONNECTORS: PaymentConnectorMeta[] = [
  {
    id: 'myfatoorah',
    label: 'MyFatoorah',
    description: 'Accept payments via KNET, Visa/MC, Apple Pay and more.',
    logoPath: '/payments/myfatoorah.svg',
    docsUrl: 'https://docs.myfatoorah.com/docs/get-started',
    fields: [
      {
        key: 'api_key',
        label: 'API Key',
        type: 'password',
        placeholder: 'rLtt6JWvbUHDDhsZnfpAhpYk4dxYDQkbcPTrTa...',
        helpText:
          'MyFatoorah Portal → Integration Settings → API Key. Use the Test API Key for sandbox.',
        required: true,
      },
      {
        key: 'environment',
        label: 'Environment',
        type: 'text',
        placeholder: 'test',
        helpText: '"test" for sandbox (apitest.myfatoorah.com) or "live" for production.',
        required: true,
      },
      {
        key: 'country_iso',
        label: 'Country Code',
        type: 'text',
        placeholder: 'KWT',
        helpText:
          'Only needed for "live" environment. ISO code: KWT, SAU, ARE, QAT, BHR, OMN, EGY, JOR.',
        required: false,
      },
    ],
  },
  // ── Add future gateways here ─────────────────────────────────────
  // {
  //   id: 'hesabe',
  //   label: 'Hesabe',
  //   description: 'Kuwait-based payment gateway.',
  //   logoPath: '/payments/hesabe.svg',
  //   fields: [...],
  // },
  // {
  //   id: 'generic',
  //   label: 'Custom / Generic',
  //   description: 'Any payment gateway via a manual payment link.',
  //   logoPath: '/payments/generic.svg',
  //   fields: [...],
  // },
];

/** Fast lookup by connector ID. Returns undefined for unknown types. */
export function getPaymentConnectorMeta(id: string): PaymentConnectorMeta | undefined {
  return PAYMENT_CONNECTORS.find((c) => c.id === id);
}

/** All registered payment connector IDs — used for API-side input validation. */
export const PAYMENT_CONNECTOR_IDS = PAYMENT_CONNECTORS.map((c) => c.id);
