"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  ShoppingCart,
  Plus,
  Trash2,
  Send,
  CheckCircle2,
  Loader2,
  Package,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";

export interface CartItem {
  id: string;
  product_id: string | null;
  product_name: string;
  product_price: number;
  variant_label: string | null;
  quantity: number;
}

export interface CartData {
  id: string;
  status: "open" | "checkout_sent" | "confirmed" | "cancelled";
  checkout_note: string | null;
  items: CartItem[];
  conversation_id: string | null;
}

export interface CartPanelProps {
  contactId: string;
  conversationId?: string;
}

export function CartPanel({ contactId, conversationId }: CartPanelProps) {
  const { accountRole, defaultCurrency } = useAuth();
  const isAdmin = accountRole === "owner" || accountRole === "admin";

  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);

  // Add Item dialog
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedVariant, setSelectedVariant] = useState("");
  const [itemQty, setItemQty] = useState(1);
  const [addingItem, setAddingItem] = useState(false);

  // Actions state
  const [sendingCheckout, setSendingCheckout] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const fetchCart = useCallback(async () => {
    if (!contactId) return;
    try {
      const res = await fetch(`/api/carts?contact_id=${contactId}`);
      if (res.ok) {
        const data = await res.json();
        setCart(data.cart);
      } else if (res.status === 404) {
        setCart(null);
      }
    } catch (err) {
      console.error("Error loading cart:", err);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    setLoading(true);
    fetchCart();
  }, [fetchCart]);

  async function openAddModal() {
    setAddModalOpen(true);
    setLoadingProducts(true);
    try {
      const res = await fetch("/api/catalog");
      if (res.ok) {
        const data = await res.json();
        const active = (data.products || []).filter((p: any) => p.is_active);
        setCatalogProducts(active);
        if (active.length > 0) {
          setSelectedProductId(active[0].id);
        }
      }
    } catch {
      toast.error("Failed to load products");
    } finally {
      setLoadingProducts(false);
    }
  }

  async function handleAddItem() {
    if (!selectedProductId) return;
    setAddingItem(true);

    try {
      // Get or create cart first if none exists
      let currentCartId = cart?.id;
      if (!currentCartId) {
        const cartRes = await fetch("/api/carts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contact_id: contactId,
            conversation_id: conversationId || null,
          }),
        });
        if (!cartRes.ok) throw new Error("Failed to create cart");
        const cartData = await cartRes.json();
        currentCartId = cartData.cart.id;
      }

      const itemRes = await fetch(`/api/carts/${currentCartId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: selectedProductId,
          quantity: itemQty,
          variant_label: selectedVariant || null,
        }),
      });

      if (!itemRes.ok) throw new Error("Failed to add item to cart");

      toast.success("Item added to cart");
      setAddModalOpen(false);
      fetchCart();
    } catch (err: any) {
      toast.error(err.message || "Failed to add item");
    } finally {
      setAddingItem(false);
    }
  }

  async function handleRemoveItem(itemId: string) {
    if (!cart) return;
    try {
      const res = await fetch(`/api/carts/${cart.id}/items/${itemId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Item removed");
        fetchCart();
      }
    } catch {
      toast.error("Failed to remove item");
    }
  }

  async function handleSendCheckout() {
    if (!cart || !conversationId) {
      toast.error("An active conversation is required to send checkout.");
      return;
    }
    setSendingCheckout(true);
    try {
      const res = await fetch(`/api/carts/${cart.id}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send checkout");
      }
      toast.success("Payment summary sent via WhatsApp!");
      fetchCart();
    } catch (err: any) {
      toast.error(err.message || "Failed to send checkout");
    } finally {
      setSendingCheckout(false);
    }
  }

  async function handleConfirmOrder() {
    if (!cart) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/carts/${cart.id}/confirm`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success("Order confirmed!");
        fetchCart();
      } else {
        toast.error("Failed to confirm order");
      }
    } catch {
      toast.error("Failed to confirm order");
    } finally {
      setConfirming(false);
    }
  }

  const items = cart?.items || [];
  const total = items.reduce(
    (sum, item) => sum + item.product_price * item.quantity,
    0
  );

  const selectedProduct = catalogProducts.find((p) => p.id === selectedProductId);

  return (
    <div>
      <div className="flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-2">
          <ShoppingCart className="h-3 w-3" />
          WhatsApp Cart
        </span>
        {cart && (
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded font-semibold capitalize ${
              cart.status === "open"
                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                : cart.status === "checkout_sent"
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : cart.status === "confirmed"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {cart.status.replace("_", " ")}
          </span>
        )}
      </div>

      <div className="mt-2 space-y-2">
        {loading ? (
          <div className="flex justify-center p-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg bg-muted/60 p-3 text-center">
            <p className="text-xs text-muted-foreground">No active cart</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-7 text-xs gap-1 w-full"
              onClick={openAddModal}
            >
              <Plus className="h-3 w-3" />
              Add Item to Cart
            </Button>
          </div>
        ) : (
          <div className="rounded-lg bg-muted/60 p-2.5 space-y-2 border border-border">
            <div className="space-y-1.5 divide-y divide-border/40">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="pt-1.5 first:pt-0 flex items-center justify-between text-xs"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="font-medium text-foreground truncate">
                      {item.product_name}
                      {item.variant_label && (
                        <span className="text-[10px] text-muted-foreground font-normal ml-1">
                          ({item.variant_label})
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {item.quantity} × {item.product_price.toFixed(2)} ={" "}
                      <span className="font-medium text-foreground">
                        {(item.quantity * item.product_price).toFixed(2)}
                      </span>
                    </p>
                  </div>
                  {cart?.status === "open" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleRemoveItem(item.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="pt-2 border-t border-border flex items-center justify-between text-xs font-semibold text-foreground">
              <span>Total:</span>
              <span>{total.toFixed(2)}</span>
            </div>

            {/* Action buttons */}
            <div className="pt-1 space-y-1">
              {cart?.status === "open" && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-7 text-xs gap-1"
                    onClick={openAddModal}
                  >
                    <Plus className="h-3 w-3" />
                    Add More Items
                  </Button>
                  <Button
                    size="sm"
                    className="w-full h-7 text-xs gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={handleSendCheckout}
                    disabled={sendingCheckout || !conversationId}
                  >
                    {sendingCheckout ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="h-3 w-3" />
                    )}
                    Send Checkout via WhatsApp
                  </Button>
                </>
              )}

              {cart?.status === "checkout_sent" && (
                <div className="space-y-1">
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium text-center">
                    Payment instructions sent to contact
                  </p>
                  {isAdmin && (
                    <Button
                      size="sm"
                      className="w-full h-7 text-xs gap-1 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={handleConfirmOrder}
                      disabled={confirming}
                    >
                      {confirming ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3" />
                      )}
                      Confirm Order Payment
                    </Button>
                  )}
                </div>
              )}

              {cart?.status === "confirmed" && (
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium text-center py-1">
                  ✓ Order confirmed & completed
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Item Modal */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              Add Product to Cart
            </DialogTitle>
          </DialogHeader>

          {loadingProducts ? (
            <div className="flex justify-center p-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : catalogProducts.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              No products found in catalog. Add products in Settings → Catalog.
            </p>
          ) : (
            <div className="space-y-3 py-2 text-xs">
              <div className="space-y-1">
                <label className="font-medium text-muted-foreground">Select Product</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => {
                    setSelectedProductId(e.target.value);
                    setSelectedVariant("");
                  }}
                  className="w-full h-8 rounded border border-border bg-muted px-2 outline-none text-xs"
                >
                  {catalogProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({defaultCurrency} {p.price.toFixed(2)})
                    </option>
                  ))}
                </select>
              </div>

              {selectedProduct?.variants && selectedProduct.variants.length > 0 && (
                <div className="space-y-1">
                  <label className="font-medium text-muted-foreground">Variant</label>
                  <select
                    value={selectedVariant}
                    onChange={(e) => setSelectedVariant(e.target.value)}
                    className="w-full h-8 rounded border border-border bg-muted px-2 outline-none text-xs"
                  >
                    <option value="">Standard</option>
                    {selectedProduct.variants.map((v: any, i: number) => (
                      <option key={i} value={v.label}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label className="font-medium text-muted-foreground">Quantity</label>
                <input
                  type="number"
                  min="1"
                  max="99"
                  value={itemQty}
                  onChange={(e) => setItemQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full h-8 rounded border border-border bg-muted px-2 outline-none text-xs"
                />
              </div>

              <Button
                className="w-full h-8 text-xs mt-2"
                onClick={handleAddItem}
                disabled={addingItem}
              >
                {addingItem && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Add to Cart
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
