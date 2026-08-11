"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Package,
  Plus,
  Trash2,
  Edit2,
  Loader2,
  CreditCard,
  CheckCircle2,
  Image as ImageIcon,
  Tag,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SettingsPanelHead } from "./settings-panel-head";
import { useAuth } from "@/hooks/use-auth";

export interface CatalogProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  image_url: string | null;
  variants: Array<{ label: string; price_modifier?: number }>;
  tags: string[];
  is_active: boolean;
  sort_order: number;
  store_connection_id?: string | null;
  external_product_id?: string | null;
  created_at: string;
  updated_at: string;
}

export function CatalogManager() {
  const { canEditSettings, defaultCurrency } = useAuth();

  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentInstructions, setPaymentInstructions] = useState("");
  const [savingInstructions, setSavingInstructions] = useState(false);

  // Dialog state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);

  // Form fields
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formCurrency, setFormCurrency] = useState(defaultCurrency || "SAR");
  const [formImageUrl, setFormImageUrl] = useState("");
  const [formTags, setFormTags] = useState("");
  const [formVariants, setFormVariants] = useState("");

  useEffect(() => {
    fetchProducts();
    fetchAccountDetails();
  }, []);

  async function fetchProducts() {
    try {
      const res = await fetch("/api/catalog");
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
      }
    } catch (err) {
      console.error("Failed to load catalog:", err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchAccountDetails() {
    try {
      const res = await fetch("/api/account");
      if (res.ok) {
        const data = await res.json();
        setPaymentInstructions(data.account?.payment_instructions || "");
      }
    } catch (err) {
      console.error("Failed to load account details:", err);
    }
  }

  function openCreateModal() {
    setEditingProduct(null);
    setFormName("");
    setFormDesc("");
    setFormPrice("");
    setFormCurrency("SAR");
    setFormImageUrl("");
    setFormTags("");
    setFormVariants("");
    setModalOpen(true);
  }

  function openEditModal(p: CatalogProduct) {
    setEditingProduct(p);
    setFormName(p.name);
    setFormDesc(p.description || "");
    setFormPrice(String(p.price));
    setFormCurrency(p.currency || "SAR");
    setFormImageUrl(p.image_url || "");
    setFormTags((p.tags || []).join(", "));
    setFormVariants(
      (p.variants || []).map((v) => v.label).filter(Boolean).join(", ")
    );
    setModalOpen(true);
  }

  async function handleSaveProduct() {
    if (!formName.trim()) {
      toast.error("Product name is required");
      return;
    }
    const priceNum = parseFloat(formPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      toast.error("Valid price is required");
      return;
    }

    setSavingProduct(true);
    const parsedTags = formTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const parsedVariants = formVariants
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((label) => ({ label }));

    const payload = {
      name: formName.trim(),
      description: formDesc.trim() || null,
      price: priceNum,
      currency: formCurrency.trim().toUpperCase(),
      image_url: formImageUrl.trim() || null,
      tags: parsedTags,
      variants: parsedVariants,
    };

    try {
      const url = editingProduct ? `/api/catalog/${editingProduct.id}` : "/api/catalog";
      const method = editingProduct ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save product");
      }

      toast.success(editingProduct ? "Product updated" : "Product created");
      setModalOpen(false);
      fetchProducts();
    } catch (err: any) {
      toast.error(err.message || "Failed to save product");
    } finally {
      setSavingProduct(false);
    }
  }

  async function handleToggleActive(p: CatalogProduct) {
    try {
      const res = await fetch(`/api/catalog/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !p.is_active }),
      });
      if (res.ok) {
        toast.success(p.is_active ? "Product hidden" : "Product activated");
        fetchProducts();
      }
    } catch {
      toast.error("Failed to toggle product status");
    }
  }

  async function handleDeleteProduct(id: string) {
    if (!confirm("Are you sure you want to delete this product?")) return;
    try {
      const res = await fetch(`/api/catalog/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Product deleted");
        fetchProducts();
      }
    } catch {
      toast.error("Failed to delete product");
    }
  }

  async function handleSavePaymentInstructions() {
    setSavingInstructions(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_instructions: paymentInstructions }),
      });
      if (res.ok) {
        toast.success("Payment instructions saved");
      } else {
        toast.error("Failed to save payment instructions");
      }
    } catch {
      toast.error("Failed to save payment instructions");
    } finally {
      setSavingInstructions(false);
    }
  }

  return (
    <section className="space-y-6 max-w-4xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Product Catalog & Payment Instructions"
        description="Manage the products your bot presents in WhatsApp and the payment instructions sent at checkout."
      />

      {/* Catalog Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Package className="size-4 text-primary" />
              Products ({products.length})
            </CardTitle>
            <CardDescription className="text-muted-foreground mt-1">
              Products are used by the WhatsApp cart bot and AI assistant to answer customer inquiries and create orders.
            </CardDescription>
          </div>
          {canEditSettings && (
            <Button onClick={openCreateModal} size="sm" className="gap-1.5">
              <Plus className="size-4" />
              Add Product
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-12 border border-dashed rounded-lg">
              <Package className="size-10 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">No products added yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Add products so your WhatsApp customers can browse, select, and checkout.
              </p>
              {canEditSettings && (
                <Button onClick={openCreateModal} variant="outline" size="sm" className="mt-4 gap-1.5">
                  <Plus className="size-4" />
                  Add First Product
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {products.map((p) => (
                <div
                  key={p.id}
                  className={`p-4 rounded-lg border flex flex-col justify-between space-y-3 transition-colors ${
                    p.is_active ? "bg-card border-border" : "bg-muted/40 border-dashed opacity-60"
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt={p.name}
                            className="size-10 rounded object-cover border"
                          />
                        ) : (
                          <div className="size-10 rounded bg-muted flex items-center justify-center text-muted-foreground">
                            <ImageIcon className="size-5" />
                          </div>
                        )}
                        <div>
                          <h4 className="font-semibold text-sm text-foreground line-clamp-1">{p.name}</h4>
                          <p className="text-xs font-medium text-primary">
                            {p.currency || defaultCurrency} {p.price.toFixed(2)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        { (p.store_connection_id || p.external_product_id) && (
                          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
                            Synced
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${
                            p.is_active
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {p.is_active ? "Active" : "Hidden"}
                        </span>
                      </div>
                    </div>

                    {p.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
                    )}

                    {p.variants && p.variants.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {p.variants.map((v, i) => (
                          <span
                            key={i}
                            className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground"
                          >
                            {v.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {canEditSettings && (
                    <div className="flex items-center justify-end gap-2 pt-2 border-t">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => handleToggleActive(p)}
                      >
                        {p.is_active ? "Hide" : "Activate"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => openEditModal(p)}
                      >
                        <Edit2 className="size-3.5 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteProduct(p.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Instructions Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <CreditCard className="size-4 text-primary" />
            Payment Instructions Template
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            This text is automatically included when a customer checks out in WhatsApp (e.g. STC Pay number, Bank IBAN, or cash instructions).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            rows={4}
            value={paymentInstructions}
            onChange={(e) => setPaymentInstructions(e.target.value)}
            placeholder="e.g. Please transfer to STC Pay: 0501234567 — Account Name: Bellapierre. Send receipt screenshot here to confirm!"
            disabled={!canEditSettings}
            className="text-sm"
          />
          {canEditSettings && (
            <Button
              onClick={handleSavePaymentInstructions}
              disabled={savingInstructions}
              className="gap-1.5"
            >
              {savingInstructions ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Save Payment Instructions
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? "Edit Product" : "Add New Product"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Product Name *</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Red Sneakers"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Price *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formPrice}
                  onChange={(e) => setFormPrice(e.target.value)}
                  placeholder="99.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Input
                  value={formCurrency}
                  onChange={(e) => setFormCurrency(e.target.value)}
                  placeholder="SAR"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="Short description of the product"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Image URL (Optional)</Label>
              <Input
                value={formImageUrl}
                onChange={(e) => setFormImageUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Variants (comma-separated)</Label>
              <Input
                value={formVariants}
                onChange={(e) => setFormVariants(e.target.value)}
                placeholder="Small, Medium, Large"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Tags (comma-separated)</Label>
              <Input
                value={formTags}
                onChange={(e) => setFormTags(e.target.value)}
                placeholder="shoes, red, sale"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveProduct} disabled={savingProduct}>
              {savingProduct && <Loader2 className="size-4 animate-spin mr-1.5" />}
              {editingProduct ? "Update Product" : "Create Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
