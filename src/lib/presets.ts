// ============================================================
// Shared suggestion presets for member titles and inbox groups
// (migration 039).
//
// These lists are the "generic options" every account gets for
// free. Accounts can additionally curate their own custom entries
// (member_titles / inbox_groups tables) — the pickers merge both
// lists. Values are stored as free text on profiles.title and
// whatsapp_config.inbox_group, so a preset or custom entry is only
// ever a suggestion, never a foreign key.
// ============================================================

export const MEMBER_TITLE_PRESETS: readonly string[] = [
  'Sales',
  'Customer Support',
  'Technical Support',
  'Account Manager',
  'Team Lead',
  'Receptionist',
] as const;

export const INBOX_GROUP_PRESETS: readonly string[] = [
  'Sales',
  'Customer Support',
  'Operations',
  'Marketing',
  'Management',
] as const;

/** Hard caps mirrored by set_member_title / the vocab API routes. */
export const MAX_MEMBER_TITLE_LENGTH = 60;
export const MAX_INBOX_GROUP_LENGTH = 60;

/** A single custom vocabulary row (member_titles / inbox_groups). */
export interface VocabEntry {
  id: string;
  name: string;
  sort_order: number;
}
