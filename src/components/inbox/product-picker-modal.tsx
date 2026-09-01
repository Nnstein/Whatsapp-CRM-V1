"use client";

import { useEffect, useState, useMemo } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Search,
  Package,
  ShoppingBag,
  Loader2,
  Check,
  Tag,
  AlertCircle,
} from "lucide-react";
import type { CatalogProduct } from "@/types";
import { toast } from "sonner";

interface ProductPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (productIds: string[], note?: string) => Promise<void> | void;
  defaultCurrency?: string;
}

export function ProductPickerModal({
  open,
  onOpenChange,
  onSend,
  defaultCurrency = "SAR",
}: ProductPickerModalProps) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedIds([]);
      setNote("");
      setSearch("");
      return;
    }

    async function loadProducts() {
      setLoading(true);
      try {
        const res = await fetch("/api/catalog");
        const data = await res.json();
        if (res.ok && Array.isArray(data.products)) {
          // Only show active products
          setProducts(data.products.filter((p: CatalogProduct) => p.is_active));
        } else {
          toast.error("Failed to load catalog products");
        }
      } catch (err) {
        console.error("Failed to fetch catalog:", err);
        toast.error("Error loading products");
      } finally {
        setLoading(false);
      }
    }

    void loadProducts();
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.tags && p.tags.some((t) => t.toLowerCase().includes(q))) ||
        (p.categories && p.categories.some((c) => c.toLowerCase().includes(q)))
    );
  }, [products, search]);

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((x) => x !== id));
    } else {
      if (selectedIds.length >= 30) {
        toast.warning("WhatsApp supports up to 30 products in a single product list.");
        return;
      }
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleSelectAllFiltered = () => {
    const filteredIds = filtered.map((p) => p.id);
    const combined = Array.from(new Set([...selectedIds, ...filteredIds])).slice(0, 30);
    setSelectedIds(combined);
  };

  const handleClearSelection = () => {
    setSelectedIds([]);
  };

  const handleSendClick = async () => {
    if (selectedIds.length === 0) return;
    try {
      setSending(true);
      await onSend(selectedIds, note.trim() || undefined);
      onOpenChange(false);
    } catch (err) {
      console.error("Send product failed:", err);
    } finally {
      setSending(false);
    }
  };

  const isSingle = selectedIds.length === 1;
  const isMulti = selectedIds.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card border-border sm:max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <ShoppingBag className="size-5 text-primary" />
            <DialogTitle className="text-foreground text-lg">Send Native WhatsApp Product</DialogTitle>
          </div>
          <DialogDescription className="text-muted-foreground text-xs">
            Send interactive WhatsApp product cards with images, prices, and an in-chat "Add to Cart" button.
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 border-b border-border space-y-3 bg-muted/20">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search products by name, SKU, tag, or category..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 bg-background border-border text-foreground text-xs h-9"
              />
            </div>
            {selectedIds.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearSelection}
                className="text-xs h-9 text-muted-foreground hover:text-foreground"
              >
                Clear ({selectedIds.length})
              </Button>
            )}
            {filtered.length > 0 && selectedIds.length < Math.min(filtered.length, 30) && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAllFiltered}
                className="text-xs h-9 border-border"
              >
                Select All ({Math.min(filtered.length, 30)})
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              {selectedIds.length === 0 ? (
                <span className="text-muted-foreground">Select 1 to 30 products to send</span>
              ) : isSingle ? (
                <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">
                  <Check className="size-3 mr-1" /> 1 product selected (Single Product Card)
                </Badge>
              ) : (
                <Badge className="bg-primary/10 text-primary border-primary/30 text-xs">
                  <Check className="size-3 mr-1" /> {selectedIds.length} products selected (Multi-Product List)
                </Badge>
              )}
            </div>
            <span className="text-muted-foreground text-[11px]">
              {products.length} active products in catalog
            </span>
          </div>
        </div>

        <ScrollArea className="flex-1 max-h-[340px] p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="size-6 animate-spin text-primary" />
              <span className="text-xs">Loading product catalog...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2 text-center">
              <Package className="size-8 stroke-[1.5]" />
              <p className="text-sm font-medium text-foreground">No products found</p>
              <p className="text-xs max-w-sm">
                {products.length === 0
                  ? "Your catalog has no active products. Add items in Settings → Product Catalog."
                  : "No products matched your search criteria."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {filtered.map((product) => {
                const isSelected = selectedIds.includes(product.id);
                const thumb = product.images?.[0] || product.image_url;
                const currency = product.currency || defaultCurrency;

                return (
                  <div
                    key={product.id}
                    onClick={() => toggleSelect(product.id)}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors text-left ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-border bg-card/60 hover:bg-muted/40"
                    }`}
                  >
                    <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(product.id)}
                        className="data-[state=checked]:bg-primary"
                      />
                    </div>

                    <div className="size-12 rounded-md bg-muted/60 shrink-0 border border-border overflow-hidden flex items-center justify-center">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={product.name}
                          className="size-full object-cover"
                        />
                      ) : (
                        <Package className="size-5 text-muted-foreground/50" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{product.name}</p>
                      <p className="text-xs font-medium text-primary mt-0.5">
                        {currency} {Number(product.price).toFixed(2)}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        {product.sku && (
                          <span className="text-[10px] text-muted-foreground font-mono truncate">
                            SKU: {product.sku}
                          </span>
                        )}
                        {Array.isArray(product.variants) && product.variants.length > 0 && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 border-border text-muted-foreground">
                            {product.variants.length} vars
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <div className="p-4 border-t border-border bg-muted/10 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Optional message note (sent alongside the product card)
            </label>
            <Textarea
              placeholder="e.g. Here is the product you were asking about! Let me know if you need any details."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-16 text-xs bg-background border-border resize-none"
            />
          </div>
        </div>

        <DialogFooter className="p-4 border-t border-border bg-card flex sm:justify-between items-center">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <AlertCircle className="size-3.5 text-muted-foreground/70" />
            <span>Requires Meta Catalog synced with your WABA</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={sending}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSendClick}
              disabled={selectedIds.length === 0 || sending}
              className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 min-w-[120px]"
            >
              {sending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                  Sending...
                </>
              ) : (
                <>
                  <ShoppingBag className="size-3.5 mr-1.5" />
                  {isSingle ? "Send Product Card" : isMulti ? `Send ${selectedIds.length} Products` : "Select Products"}
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
