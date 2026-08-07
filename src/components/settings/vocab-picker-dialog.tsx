'use client';

// ============================================================
// VocabPickerDialog — shared picker for free-text "vocabulary"
// values backed by code presets + account-curated custom entries
// (migration 039).
//
// Used for:
//   - Member titles  (Settings → Members, profiles.title)
//   - Inbox groups   (Settings → WhatsApp, whatsapp_config.inbox_group)
//
// The admin picks one of the generic presets or a custom entry, can
// create a new custom entry inline (it becomes the pending pick),
// and can delete custom entries. Saving persists the *string value*
// — never a FK — so deleting a custom entry later never breaks
// rows that already carry it.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { VocabEntry } from '@/lib/presets';

interface VocabPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog heading, e.g. "Edit member title". */
  title: string;
  description?: string;
  /** Currently saved value (null = none). */
  value: string | null;
  /** Generic suggestions available to every account. */
  presets: readonly string[];
  /** Account-curated custom entries. */
  custom: VocabEntry[];
  saving: boolean;
  /** Persist the picked value (null clears). Parent closes the dialog. */
  onSave: (value: string | null) => void;
  /** Create a custom vocabulary entry; resolve true when created. */
  onCreateCustom: (name: string) => Promise<boolean>;
  /** Delete a custom vocabulary entry. */
  onDeleteCustom: (id: string) => void;
  /** Label for the cleared state, e.g. "No title" / "Ungrouped". */
  noneLabel: string;
  /** Placeholder for the custom-entry input. */
  createPlaceholder: string;
  /** Hard cap shown inline + enforced before calling onCreateCustom. */
  maxLength: number;
}

export function VocabPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  value,
  presets,
  custom,
  saving,
  onSave,
  onCreateCustom,
  onDeleteCustom,
  noneLabel,
  createPlaceholder,
  maxLength,
}: VocabPickerDialogProps) {
  const [selected, setSelected] = useState<string | null>(value);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Re-seed the pending pick every time the dialog opens for a
  // different row.
  useEffect(() => {
    if (open) {
      setSelected(value);
      setNewName('');
    }
  }, [open, value]);

  // Merged options: presets first, then customs. Case-insensitive
  // dedupe so a custom "Sales" doesn't duplicate the preset.
  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; name: string; customId: string | null }[] = [];
    for (const name of presets) {
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ key: `preset:${k}`, name, customId: null });
    }
    for (const entry of custom) {
      const k = entry.name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ key: `custom:${entry.id}`, name: entry.name, customId: entry.id });
    }
    return out;
  }, [presets, custom]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    if (name.length > maxLength) {
      toast.error(`Must be ${maxLength} characters or fewer`);
      return;
    }
    setCreating(true);
    try {
      const ok = await onCreateCustom(name);
      if (ok) {
        setSelected(name);
        setNewName('');
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-muted-foreground">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="py-2 space-y-1 max-h-64 overflow-y-auto">
          {/* Cleared state */}
          <button
            type="button"
            onClick={() => setSelected(null)}
            className={cn(
              'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors',
              selected === null
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted/70',
            )}
          >
            <span className="italic">{noneLabel}</span>
            {selected === null && <Check className="size-4 text-primary" />}
          </button>

          {options.map((opt) => {
            const isSelected = selected?.toLowerCase() === opt.name.toLowerCase();
            return (
              <div key={opt.key} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelected(opt.name)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors',
                    isSelected
                      ? 'border-primary/50 bg-primary/10 text-foreground'
                      : 'border-border bg-muted/40 text-foreground hover:bg-muted/70',
                  )}
                >
                  <span className="truncate">{opt.name}</span>
                  {isSelected && <Check className="size-4 shrink-0 text-primary" />}
                </button>
                {opt.customId && (
                  <button
                    type="button"
                    onClick={() => onDeleteCustom(opt.customId!)}
                    aria-label={`Delete custom entry "${opt.name}"`}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Inline custom-entry creation */}
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={createPlaceholder}
            maxLength={maxLength}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreate();
              }
            }}
            className="bg-muted border-border text-foreground"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleCreate()}
            disabled={creating || !newName.trim()}
            className="shrink-0 border-border text-muted-foreground hover:text-foreground"
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add
          </Button>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onSave(selected)}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
