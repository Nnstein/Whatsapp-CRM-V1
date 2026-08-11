/**
 * Universal Store Adapter Registry.
 */

import type { UniversalStoreAdapter } from './types';
import { zidAdapter } from './zid';
import { genericAdapter } from './generic';

export const STORE_ADAPTERS: Record<string, UniversalStoreAdapter> = {
  zid: zidAdapter,
  generic: genericAdapter,
};

/** Get the universal store adapter for a given connector type. */
export function getStoreAdapter(type: string): UniversalStoreAdapter | undefined {
  return STORE_ADAPTERS[type.toLowerCase().trim()];
}
