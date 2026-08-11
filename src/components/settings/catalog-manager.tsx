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
  LayoutGrid,
  List,
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  UploadCloud,
  X,
} from "lucide-react";
import { uploadAccountMedia } from "@/lib/storage/upload-media";

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
  sku?: string | null;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  quantity?: string;
  categories?: string[];
  image_url: string | null;
  images?: string[];
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
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);

  // View, search, sort & pagination state
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'hidden'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<'created-desc' | 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc' | 'qty-desc'>('created-desc');
  const [pageSize, setPageSize] = useState(12);
  const [currentPage, setCurrentPage] = useState(1);

  // Form fields
  const [formSku, setFormSku] = useState("");
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formQuantity, setFormQuantity] = useState("Infinite");
  const [formImages, setFormImages] = useState<string[]>([]);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [formTags, setFormTags] = useState("");
  const [formVariants, setFormVariants] = useState("");

  const activeCurrency = defaultCurrency || "SAR";

  const activeCount = products.filter((p) => p.is_active).length;
  const hiddenCount = products.filter((p) => !p.is_active).length;

  const filteredProducts = products.filter((p) => {
    if (statusFilter === 'active' && !p.is_active) return false;
    if (statusFilter === 'hidden' && p.is_active) return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.sku && p.sku.toLowerCase().includes(q)) ||
      (p.description && p.description.toLowerCase().includes(q)) ||
      (p.tags && p.tags.some((t) => t.toLowerCase().includes(q))) ||
      (p.categories && p.categories.some((c) => c.toLowerCase().includes(q)))
    );
  });

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    switch (sortOption) {
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'name-desc':
        return b.name.localeCompare(a.name);
      case 'price-asc':
        return a.price - b.price;
      case 'price-desc':
        return b.price - a.price;
      case 'qty-desc': {
        const qA = a.quantity === 'Infinite' ? 999999 : parseInt(a.quantity || '0', 10) || 0;
        const qB = b.quantity === 'Infinite' ? 999999 : parseInt(b.quantity || '0', 10) || 0;
        return qB - qA;
      }
      case 'created-desc':
      default:
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    }
  });

  const totalPages = Math.max(1, Math.ceil(sortedProducts.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedProducts = sortedProducts.slice(startIndex, startIndex + pageSize);

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
    setFormSku("");
    setFormName("");
    setFormDesc("");
    setFormPrice("");
    setFormQuantity("Infinite");
    setFormImages([]);
    setNewImageUrl("");
    setFormTags("");
    setFormVariants("");
    setModalOpen(true);
  }

  function openEditModal(p: CatalogProduct) {
    setEditingProduct(p);
    setFormSku(p.sku || "");
    setFormName(p.name);
    setFormDesc(p.description || "");
    setFormPrice(String(p.price));
    setFormQuantity(p.quantity || "Infinite");
    setFormImages(p.images && p.images.length > 0 ? p.images : p.image_url ? [p.image_url] : []);
    setNewImageUrl("");
    setFormTags((p.tags || []).join(", "));
    setFormVariants(
      (p.variants || []).map((v) => v.label).filter(Boolean).join(", ")
    );
    setModalOpen(true);
  }

  async function handleFileUpload(files: FileList | File[]) {
    if (!files || files.length === 0) return;
    setUploadingImage(true);

    const uploadedUrls: string[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name} is not an image file`);
        continue;
      }
      try {
        const { publicUrl } = await uploadAccountMedia("chat-media", file);
        uploadedUrls.push(publicUrl);
      } catch {
        // Fallback to FileReader Data URL
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        uploadedUrls.push(dataUrl);
      }
    }

    if (uploadedUrls.length > 0) {
      setFormImages((prev) => [...prev, ...uploadedUrls]);
      toast.success(`Added ${uploadedUrls.length} image(s)`);
    }
    setUploadingImage(false);
  }

  function handleAddImageUrl() {
    if (!newImageUrl.trim()) return;
    const url = newImageUrl.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("data:")) {
      toast.error("Valid image URL required");
      return;
    }
    setFormImages((prev) => [...prev, url]);
    setNewImageUrl("");
  }

  function handleRemoveImage(index: number) {
    setFormImages((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSetCoverImage(index: number) {
    if (index === 0) return;
    setFormImages((prev) => {
      const copy = [...prev];
      const [target] = copy.splice(index, 1);
      return [target, ...copy];
    });
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
      sku: formSku.trim() || null,
      name: formName.trim(),
      description: formDesc.trim() || null,
      price: priceNum,
      quantity: formQuantity.trim() || "Infinite",
      currency: activeCurrency,
      image_url: formImages[0] || null,
      images: formImages,
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

  async function handleImportCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingCsv(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/catalog/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to import CSV");
      }

      toast.success(`Successfully imported ${data.imported_count ?? 0} products!`);
      setUploadModalOpen(false);
      fetchProducts();
    } catch (err: any) {
      toast.error(err.message || "CSV upload failed");
    } finally {
      setUploadingCsv(false);
      e.target.value = "";
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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open("/api/catalog/export", "_blank")}
              className="gap-1.5 text-xs"
            >
              Export CSV
            </Button>
            {canEditSettings && (
              <>
                <label className="cursor-pointer">
                  <span className="inline-flex items-center justify-center gap-1.5 text-xs font-medium h-8 px-3 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground">
                    Upload CSV
                  </span>
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleImportCsv}
                    disabled={uploadingCsv}
                  />
                </label>
                <Button onClick={openCreateModal} size="sm" className="gap-1.5">
                  <Plus className="size-4" />
                  Add Product
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Toolbar: Search, Sort, Page Size & View Mode Toggle */}
          {products.length > 0 && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pb-2 border-b">
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, SKU, or tag..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="pl-8 h-8 text-xs"
                  />
                </div>

                <div className="flex items-center border rounded-md p-0.5 bg-muted/40 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter('all');
                      setCurrentPage(1);
                    }}
                    className={`px-2 py-1 rounded-sm text-[11px] font-medium transition-colors ${
                      statusFilter === 'all'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    All ({products.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter('active');
                      setCurrentPage(1);
                    }}
                    className={`px-2 py-1 rounded-sm text-[11px] font-medium transition-colors ${
                      statusFilter === 'active'
                        ? 'bg-background text-emerald-600 dark:text-emerald-400 shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Active ({activeCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter('hidden');
                      setCurrentPage(1);
                    }}
                    className={`px-2 py-1 rounded-sm text-[11px] font-medium transition-colors ${
                      statusFilter === 'hidden'
                        ? 'bg-background text-amber-600 dark:text-amber-400 shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Hidden ({hiddenCount})
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <ArrowUpDown className="size-3.5 text-muted-foreground" />
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none"
                    value={sortOption}
                    onChange={(e) => {
                      setSortOption(e.target.value as any);
                      setCurrentPage(1);
                    }}
                  >
                    <option value="created-desc">Newest First</option>
                    <option value="name-asc">Name: A to Z</option>
                    <option value="name-desc">Name: Z to A</option>
                    <option value="price-asc">Price: Low to High</option>
                    <option value="price-desc">Price: High to Low</option>
                    <option value="qty-desc">Highest Stock</option>
                  </select>
                </div>

                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                >
                  <option value={8}>8 / page</option>
                  <option value={12}>12 / page</option>
                  <option value={24}>24 / page</option>
                  <option value={50}>50 / page</option>
                </select>

                <div className="flex items-center border rounded-md p-0.5 bg-muted/40">
                  <Button
                    type="button"
                    variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setViewMode('grid')}
                    title="Tiles View"
                  >
                    <LayoutGrid className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setViewMode('list')}
                    title="List View"
                  >
                    <List className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-12 border border-dashed rounded-lg space-y-3">
              <Package className="size-10 text-muted-foreground/50 mx-auto" />
              <p className="text-sm font-medium text-foreground">No products added yet</p>
              <p className="text-xs text-muted-foreground">
                Add products manually or upload a Zid-compatible CSV file.
              </p>
              {canEditSettings && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <label className="cursor-pointer">
                    <span className="inline-flex items-center justify-center gap-1.5 text-xs font-medium h-8 px-3 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground">
                      Upload CSV
                    </span>
                    <input
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={handleImportCsv}
                      disabled={uploadingCsv}
                    />
                  </label>
                  <Button onClick={openCreateModal} variant="default" size="sm" className="gap-1.5">
                    <Plus className="size-4" />
                    Add Product
                  </Button>
                </div>
              )}
            </div>
          ) : sortedProducts.length === 0 ? (
            <div className="text-center py-8 border border-dashed rounded-lg">
              <p className="text-xs text-muted-foreground">No products matching "{searchQuery}"</p>
            </div>
          ) : viewMode === 'list' ? (
            /* List View Table */
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                  <tr>
                    <th className="p-2.5">Product</th>
                    <th className="p-2.5">SKU</th>
                    <th className="p-2.5">Stock</th>
                    <th className="p-2.5">Price ({activeCurrency})</th>
                    <th className="p-2.5">Status</th>
                    {canEditSettings && <th className="p-2.5 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {paginatedProducts.map((p) => (
                    <tr key={p.id} className={!p.is_active ? 'opacity-60 bg-muted/20' : ''}>
                      <td className="p-2.5">
                        <div className="flex items-center gap-2">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} className="size-8 rounded object-cover border" />
                          ) : (
                            <div className="size-8 rounded bg-muted flex items-center justify-center text-muted-foreground">
                              <ImageIcon className="size-4" />
                            </div>
                          )}
                          <div>
                            <span className="font-semibold text-foreground line-clamp-1">{p.name}</span>
                            {p.description && (
                              <span className="text-[10px] text-muted-foreground line-clamp-1">{p.description}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="p-2.5 font-mono text-[11px] text-muted-foreground">{p.sku || '—'}</td>
                      <td className="p-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          p.quantity === '0' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground'
                        }`}>
                          {p.quantity || 'Infinite'}
                        </span>
                      </td>
                      <td className="p-2.5 font-medium text-primary">
                        {activeCurrency} {p.price.toFixed(2)}
                      </td>
                      <td className="p-2.5">
                        <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${
                          p.is_active ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'
                        }`}>
                          {p.is_active ? 'Active' : 'Hidden'}
                        </span>
                      </td>
                      {canEditSettings && (
                        <td className="p-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                              onClick={() => handleToggleActive(p)}
                            >
                              {p.is_active ? 'Hide' : 'Activate'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-[11px] px-2"
                              onClick={() => openEditModal(p)}
                            >
                              <Edit2 className="size-3 mr-1" /> Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                              onClick={() => handleDeleteProduct(p.id)}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* Tiles / Grid View */
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {paginatedProducts.map((p) => (
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
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs font-medium text-primary">
                              {activeCurrency} {p.price.toFixed(2)}
                            </span>
                            {p.sku && (
                              <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                                SKU: {p.sku}
                              </span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              p.quantity === '0'
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                : 'bg-muted text-muted-foreground'
                            }`}>
                              Qty: {p.quantity || 'Infinite'}
                            </span>
                          </div>
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
                        className="h-8 text-xs"
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

          {/* Pagination Controls Footer */}
          {sortedProducts.length > 0 && (
            <div className="flex items-center justify-between pt-4 border-t text-xs text-muted-foreground">
              <span>
                Showing {startIndex + 1}–{Math.min(startIndex + pageSize, sortedProducts.length)} of {sortedProducts.length} products
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  className="h-7 px-2"
                >
                  <ChevronLeft className="size-3.5 mr-1" /> Prev
                </Button>
                <span className="px-2 font-mono">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  className="h-7 px-2"
                >
                  Next <ChevronRight className="size-3.5 ml-1" />
                </Button>
              </div>
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
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4 border-b">
            <DialogTitle>
              {editingProduct ? "Edit Product" : "Add New Product"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 p-6 overflow-y-auto max-h-[calc(90vh-130px)]">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Product Name *</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Red Sneakers"
                />
              </div>
              <div className="space-y-1.5">
                <Label>SKU (Optional)</Label>
                <Input
                  value={formSku}
                  onChange={(e) => setFormSku(e.target.value)}
                  placeholder="e.g. MF01"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Price ({activeCurrency}) *</Label>
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
                <Label>Quantity</Label>
                <Input
                  value={formQuantity}
                  onChange={(e) => setFormQuantity(e.target.value)}
                  placeholder="Infinite"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="Short description of the product"
              />
            </div>

            {/* Product Images Drag & Drop + Gallery */}
            <div className="space-y-2">
              <Label className="flex items-center justify-between text-xs">
                <span>Product Images ({formImages.length})</span>
                <span className="text-[10px] text-muted-foreground">Click thumbnail to set Cover image</span>
              </Label>

              {/* Drag & Drop Zone */}
              <label className="border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors text-center relative">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                  disabled={uploadingImage}
                />
                {uploadingImage ? (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="size-5 animate-spin text-primary" />
                    <span className="text-xs font-medium">Uploading images...</span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <UploadCloud className="size-6 text-muted-foreground mx-auto" />
                    <p className="text-xs font-medium text-foreground">
                      Drag & drop images here, or <span className="text-primary underline">browse</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground">Supports multiple files (PNG, JPG, WEBP)</p>
                  </div>
                )}
              </label>

              {/* Or Paste Direct Image URL */}
              <div className="flex items-center gap-1.5 pt-1">
                <Input
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                  placeholder="Or paste image URL (https://...)"
                  className="text-xs h-8"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddImageUrl();
                    }
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={handleAddImageUrl} className="h-8 text-xs">
                  Add URL
                </Button>
              </div>

              {/* Image Gallery Grid */}
              {formImages.length > 0 && (
                <div className="grid grid-cols-4 gap-2 pt-2">
                  {formImages.map((url, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleSetCoverImage(idx)}
                      className={`relative group rounded-md overflow-hidden border aspect-square cursor-pointer transition-all ${
                        idx === 0 ? 'ring-2 ring-primary border-transparent' : 'hover:border-primary'
                      }`}
                      title={idx === 0 ? 'Cover image' : 'Click to make Cover image'}
                    >
                      <img src={url} alt={`Product image ${idx + 1}`} className="w-full h-full object-cover" />
                      {idx === 0 && (
                        <span className="absolute top-1 left-1 bg-emerald-600 text-white text-[9px] px-1 py-0.5 rounded font-medium shadow">
                          Cover
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveImage(idx);
                        }}
                        className="absolute top-1 right-1 bg-black/70 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
                        title="Remove image"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
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

          <DialogFooter className="p-4 border-t bg-muted/40 flex items-center justify-end gap-2">
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
