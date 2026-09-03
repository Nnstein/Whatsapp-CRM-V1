"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  MessageCircle,
  ArrowDownToLine,
  Smartphone,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { WhatsAppConfig } from "@/types";
import { parseWhatsAppChat } from "@/lib/chat-import/parser";

// ─── Types ──────────────────────────────────────────────────────

interface ImportChatModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The contact this import is pinned to. MUST be provided. */
  contact: {
    id: string;
    name?: string | null;
    phone: string;
  };
  /** Called after a successful import with the conversation id. */
  onImported?: (conversationId: string, importedCount: number) => void;
  /** Current user's display name (pre-fills the "Your name in this chat" field). */
  defaultMerchantName?: string;
}

type Step = "upload" | "configure" | "importing" | "done";

interface PreviewMessage {
  isOutbound: boolean;
  senderName: string;
  text: string;
  time: string;
}

// ─── Step indicators ─────────────────────────────────────────────

const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "configure", label: "Configure" },
  { key: "importing", label: "Import" },
];

function StepDots({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center justify-center gap-2 mb-5">
      {STEPS.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <div
            className={`flex items-center justify-center size-6 rounded-full text-[11px] font-semibold border transition-colors ${
              i < idx
                ? "bg-primary border-primary text-primary-foreground"
                : i === idx
                ? "bg-primary/10 border-primary text-primary"
                : "bg-muted border-border text-muted-foreground"
            }`}
          >
            {i < idx ? <CheckCircle2 className="size-3.5" /> : i + 1}
          </div>
          <span
            className={`text-xs hidden sm:block ${
              i === idx ? "text-foreground font-medium" : "text-muted-foreground"
            }`}
          >
            {s.label}
          </span>
          {i < STEPS.length - 1 && (
            <ChevronRight className="size-3 text-muted-foreground/40" />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────

export function ImportChatModal({
  open,
  onOpenChange,
  contact,
  onImported,
  defaultMerchantName = "",
}: ImportChatModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);

  // Upload step state
  const [file, setFile] = useState<File | null>(null);

  // Configure step state
  const [merchantName, setMerchantName] = useState(defaultMerchantName);
  const [whatsappConfigId, setWhatsappConfigId] = useState<string>("__default__");
  const [whatsappNumbers, setWhatsappNumbers] = useState<WhatsAppConfig[]>([]);
  const [loadingNumbers, setLoadingNumbers] = useState(false);
  const [preview, setPreview] = useState<PreviewMessage[]>([]);

  // Import step state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
    total: number;
    conversationId: string;
    mediaUploaded?: number;
    mediaLinked?: number;
    phase?: number;
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // ── Reset on close ───────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setStep("upload");
      setFile(null);
      setPreview([]);
      setImportResult(null);
      setImportError(null);
      setDragging(false);
    }
  }, [open]);

  // ── Load WhatsApp numbers ────────────────────────────────────
  useEffect(() => {
    if (!open || whatsappNumbers.length > 0) return;
    setLoadingNumbers(true);
    fetch("/api/account/whatsapp-numbers")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.whatsapp_numbers)) {
          setWhatsappNumbers(d.whatsapp_numbers);
          const def = d.whatsapp_numbers.find((n: WhatsAppConfig) => n.is_default);
          if (def) setWhatsappConfigId(def.id);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingNumbers(false));
  }, [open, whatsappNumbers.length]);

  // ── File validation and preview ──────────────────────────────
  const handleFile = useCallback(
    (f: File) => {
      const name = f.name.toLowerCase();
      if (!name.endsWith(".txt") && !name.endsWith(".zip")) {
        toast.error("Only .txt or .zip WhatsApp export files are supported.");
        return;
      }
      if (name.endsWith(".zip") && f.size > 200 * 1024 * 1024) {
        toast.error("Zip file is too large (max 200 MB).");
        return;
      }
      if (name.endsWith(".txt") && f.size > 50 * 1024 * 1024) {
        toast.error("Text file is too large (max 50 MB).");
        return;
      }
      setFile(f);

      // Only preview text files inline — zip files are processed server-side
      if (name.endsWith(".zip")) {
        setPreview([]);
        return;
      }

      // Generate quick preview using parser
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const parsed = parseWhatsAppChat(text, merchantName || "Merchant");
        const sample = parsed.messages.slice(0, 5);
        setPreview(
          sample.map((m) => ({
            isOutbound: m.isOutbound,
            senderName: m.senderName,
            text: m.contentText ?? "[Media]",
            time: `${m.timestamp.getHours()}:${String(m.timestamp.getMinutes()).padStart(2, "0")}`,
          }))
        );
      };
      reader.readAsText(f);
    },
    [merchantName]
  );

  // ── Drag and drop ────────────────────────────────────────────
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) handleFile(dropped);
    },
    [handleFile]
  );

  // ── Import ───────────────────────────────────────────────────
  const handleImport = useCallback(async () => {
    if (!file || !merchantName.trim()) return;

    setStep("importing");
    setImporting(true);
    setImportError(null);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("contact_id", contact.id);
      form.append("merchant_name", merchantName.trim());
      if (whatsappConfigId && whatsappConfigId !== "__default__") {
        form.append("whatsapp_config_id", whatsappConfigId);
      }

      const res = await fetch("/api/contacts/import-chat", {
        method: "POST",
        body: form,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setImportError(data?.error ?? `HTTP ${res.status}`);
        setImporting(false);
        return;
      }

      setImportResult({
        imported: data.imported,
        skipped: data.skipped,
        total: data.total,
        conversationId: data.conversation_id,
        mediaUploaded: data.media_uploaded,
        mediaLinked: data.media_linked,
        phase: data.phase,
      });
      setStep("done");
      onImported?.(data.conversation_id, data.imported);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Network error";
      setImportError(reason);
    } finally {
      setImporting(false);
    }
  }, [file, merchantName, whatsappConfigId, contact.id, onImported]);

  // ── Regenerate preview when merchantName changes ─────────────
  useEffect(() => {
    if (!file || !merchantName || file.name.toLowerCase().endsWith(".zip")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseWhatsAppChat(text, merchantName);
      const sample = parsed.messages.slice(0, 5);
      setPreview(
        sample.map((m) => ({
          isOutbound: m.isOutbound,
          senderName: m.senderName,
          text: m.contentText ?? "[Media]",
          time: `${m.timestamp.getHours()}:${String(m.timestamp.getMinutes()).padStart(2, "0")}`,
        }))
      );
    };
    reader.readAsText(file);
  }, [merchantName, file]);

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-card border-border flex flex-col p-0 gap-0 overflow-hidden sm:max-h-[92vh]">
        <DialogHeader className="p-5 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <ArrowDownToLine className="size-5 text-primary" />
            <DialogTitle className="text-foreground text-base">
              Import WhatsApp Chat History
            </DialogTitle>
          </div>
          <DialogDescription className="text-muted-foreground text-xs">
            For{" "}
            <span className="font-medium text-foreground">
              {contact.name || contact.phone}
            </span>{" "}
            — historical messages will appear before live Cloud API messages.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="p-5">
            {/* ── Step indicator ─────────────────────────────── */}
            {step !== "done" && <StepDots current={step} />}

            {/* ─────────────────────────────────────────────── */}
            {/* Step 1: Upload                                  */}
            {/* ─────────────────────────────────────────────── */}
            {step === "upload" && (
              <div className="space-y-4">
                {/* How to export instructions */}
                <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                  <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Smartphone className="size-3.5 text-primary" />
                    How to export from WhatsApp
                  </p>
                  <ol className="text-[11px] text-muted-foreground space-y-1 list-decimal ml-4">
                    <li>Open the chat with this customer in WhatsApp</li>
                    <li>Tap the three-dot menu (⋮) → <strong>More</strong> → <strong>Export Chat</strong></li>
                    <li>
                      Choose export type:
                      <ul className="mt-1 space-y-1 list-disc ml-4">
                        <li><strong>Without Media</strong> → upload the <code className="bg-muted px-1 rounded text-[10px]">_chat.txt</code></li>
                        <li><strong>Include Media</strong> → upload the <code className="bg-muted px-1 rounded text-[10px]">.zip</code> file ✨</li>
                      </ul>
                    </li>
                    <li>Transfer the file to your computer and upload it here</li>
                  </ol>
                </div>

                {/* Dropzone */}
                <div
                  ref={dropRef}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors p-8 ${
                    dragging
                      ? "border-primary bg-primary/5"
                      : file
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/40"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.zip"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                    }}
                  />

                  {file ? (
                    <>
                      <CheckCircle2 className="size-8 text-emerald-500" />
                      <div className="text-center">
                        <p className="text-sm font-semibold text-foreground">{file.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {(file.size / 1024).toFixed(0)} KB — click to change
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <Upload className="size-8 text-muted-foreground/50" />
                      <div className="text-center">
                        <p className="text-sm font-medium text-foreground">
                          Drop your export file here
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <code className="text-primary bg-primary/10 px-1 rounded text-xs">.txt</code>
                          {' or '}
                          <code className="text-emerald-400 bg-emerald-500/10 px-1 rounded text-xs">.zip</code>
                          {' — max 50 MB / 200 MB'}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ─────────────────────────────────────────────── */}
            {/* Step 2: Configure                               */}
            {/* ─────────────────────────────────────────────── */}
            {step === "configure" && (
              <div className="space-y-4">
                {/* Merchant name input */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Your name in this chat{" "}
                    <span className="text-muted-foreground/60">(exactly as it appears in the export)</span>
                  </Label>
                  <Input
                    value={merchantName}
                    onChange={(e) => setMerchantName(e.target.value)}
                    placeholder="e.g. Bella Piérre, Owner, Customer Support..."
                    className="bg-background border-border text-foreground text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    This is used to determine which messages you sent (outbound) vs messages the customer sent (inbound).
                  </p>
                </div>

                {/* WhatsApp number picker */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Which WhatsApp number is this chat from?
                  </Label>
                  {loadingNumbers ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      Loading numbers...
                    </div>
                  ) : (
                    <Select value={whatsappConfigId} onValueChange={(v) => { if (v) setWhatsappConfigId(v); }}>
                      <SelectTrigger className="bg-background border-border text-foreground text-sm">
                        <SelectValue placeholder="Select WhatsApp number" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        <SelectItem value="__default__" className="text-muted-foreground text-xs">
                          Account default number
                        </SelectItem>
                        {whatsappNumbers.map((n) => (
                          <SelectItem key={n.id} value={n.id} className="text-sm">
                            {n.label || n.phone_number_id}
                            {n.is_default && (
                              <Badge variant="outline" className="ml-2 text-[9px] border-primary/30 text-primary">
                                default
                              </Badge>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Preview */}
                {preview.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <MessageCircle className="size-3 text-muted-foreground" />
                      Preview (first {preview.length} messages detected)
                    </Label>
                    <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                      {preview.map((m, i) => (
                        <div
                          key={i}
                          className={`flex ${m.isOutbound ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-lg px-2.5 py-1.5 text-xs ${
                              m.isOutbound
                                ? "bg-primary/15 text-foreground"
                                : "bg-muted text-foreground"
                            }`}
                          >
                            {!m.isOutbound && (
                              <p className="text-[10px] font-medium text-primary mb-0.5">{m.senderName}</p>
                            )}
                            <p className="leading-relaxed">{m.text}</p>
                            <p className="text-[10px] text-muted-foreground text-right mt-0.5">{m.time}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Outbound (your messages) appear on the right. If direction looks wrong, adjust your name above.
                    </p>
                  </div>
                )}

                {/* File summary */}
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="font-medium text-foreground">{file?.name}</span>
                  <button
                    className="ml-auto text-muted-foreground hover:text-foreground"
                    onClick={() => { setFile(null); setStep("upload"); setPreview([]); }}
                    title="Change file"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* ─────────────────────────────────────────────── */}
            {/* Step 3: Importing                               */}
            {/* ─────────────────────────────────────────────── */}
            {step === "importing" && (
              <div className="flex flex-col items-center justify-center py-10 gap-4">
                {importing ? (
                  <>
                    <Loader2 className="size-10 animate-spin text-primary" />
                    <div className="text-center">
                      <p className="text-sm font-semibold text-foreground">Importing messages...</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Parsing and inserting your chat history into the CRM.
                      </p>
                    </div>
                  </>
                ) : importError ? (
                  <>
                    <AlertCircle className="size-10 text-destructive" />
                    <div className="text-center space-y-1">
                      <p className="text-sm font-semibold text-destructive">Import failed</p>
                      <p className="text-xs text-muted-foreground max-w-sm">{importError}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setStep("configure"); setImportError(null); }}
                      className="text-xs"
                    >
                      <ChevronLeft className="size-3.5 mr-1" />
                      Back to configure
                    </Button>
                  </>
                ) : null}
              </div>
            )}

            {/* ─────────────────────────────────────────────── */}
            {/* Step 4: Done                                    */}
            {/* ─────────────────────────────────────────────── */}
            {step === "done" && importResult && (
              <div className="flex flex-col items-center justify-center py-8 gap-4 text-center">
                <CheckCircle2 className="size-14 text-emerald-500" />
                <div className="space-y-1">
                  <p className="text-base font-bold text-foreground">Chat history imported!</p>
                  <p className="text-sm text-muted-foreground">
                    {importResult.imported.toLocaleString()} messages imported
                    {importResult.skipped > 0 && `, ${importResult.skipped} duplicates skipped`}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3 w-full max-w-xs mt-2">
                  {[
                    { label: "Imported", value: importResult.imported, color: "text-emerald-400" },
                    { label: "Skipped", value: importResult.skipped, color: "text-amber-400" },
                    { label: "Total", value: importResult.total, color: "text-primary" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-lg border border-border bg-muted/20 p-2.5">
                      <p className={`text-lg font-bold ${color}`}>{value.toLocaleString()}</p>
                      <p className="text-[11px] text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>

                <p className="text-[11px] text-muted-foreground max-w-xs">
                  Open the Inbox conversation for{" "}
                  <span className="font-medium">{contact.name || contact.phone}</span> to see
                  the full history. A <strong>📜 Imported History</strong> divider separates
                  old messages from new live ones.
                </p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer actions */}
        <DialogFooter className="p-4 border-t border-border bg-card flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs text-muted-foreground"
          >
            {step === "done" ? "Close" : "Cancel"}
          </Button>

          <div className="flex items-center gap-2">
            {step === "configure" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep("upload")}
                className="text-xs"
              >
                <ChevronLeft className="size-3.5 mr-1" />
                Back
              </Button>
            )}
            {step === "upload" && (
              <Button
                size="sm"
                disabled={!file}
                onClick={() => setStep("configure")}
                className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Next
                <ChevronRight className="size-3.5 ml-1" />
              </Button>
            )}
            {step === "configure" && (
              <Button
                size="sm"
                disabled={!merchantName.trim() || importing}
                onClick={handleImport}
                className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 min-w-27.5"
              >
                <ArrowDownToLine className="size-3.5 mr-1.5" />
                Import Chat
              </Button>
            )}
            {step === "done" && (
              <Button
                size="sm"
                onClick={() => onOpenChange(false)}
                className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Done
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
