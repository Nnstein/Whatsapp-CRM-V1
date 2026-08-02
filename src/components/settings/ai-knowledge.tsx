'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  RefreshCw,
  BookOpen,
  Globe,
  Upload,
  FileText,
  Link,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

interface DocSummary {
  id: string;
  title: string;
  updated_at: string;
}

/** Editor target: 'new' when creating, a doc id when editing, null when closed. */
type EditTarget = 'new' | string | null;
type ImportTab = 'text' | 'file' | 'url';

export function AiKnowledgeCard({
  accountId,
  canEdit,
  hasEmbeddingsKey,
}: {
  accountId: string | null;
  canEdit: boolean;
  hasEmbeddingsKey: boolean;
}) {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditTarget>(null);
  const [importTab, setImportTab] = useState<ImportTab>('text');

  // Input states
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [urlInput, setUrlInput] = useState('');

  // Status flags
  const [saving, setSaving] = useState(false);
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/knowledge');
      const data = await res.json();
      if (res.ok) setDocs(data.documents ?? []);
      else toast.error(data.error ?? 'Failed to load knowledge base');
    } catch {
      toast.error('Failed to load knowledge base');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchDocs();
  }, [accountId, fetchDocs]);

  const openNew = (tab: ImportTab = 'text') => {
    setEditing('new');
    setImportTab(tab);
    setTitle('');
    setContent('');
    setUrlInput('');
  };

  const openEdit = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to open document');
        return;
      }
      setEditing(id);
      setImportTab('text');
      setTitle(data.title ?? '');
      setContent(data.content ?? '');
    } catch {
      toast.error('Failed to open document');
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    setImportTab('text');
    setTitle('');
    setContent('');
    setUrlInput('');
  };

  const handleFetchUrl = async () => {
    if (!urlInput.trim()) {
      toast.error('Please enter a web URL.');
      return;
    }
    setFetchingUrl(true);
    try {
      const res = await fetch('/api/ai/knowledge/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTitle(data.title || 'Web Page Document');
        setContent(data.content || '');
        setImportTab('text'); // Switch to editor preview
        toast.success('Web page content extracted successfully!');
      } else {
        toast.error(data.error ?? 'Failed to fetch URL content.');
      }
    } catch {
      toast.error('Failed to fetch URL content.');
    } finally {
      setFetchingUrl(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/ai/knowledge/import-file', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTitle(data.title || file.name);
        setContent(data.content || '');
        setImportTab('text'); // Switch to editor preview
        toast.success(`Extracted text from ${file.name}`);
      } else {
        toast.error(data.error ?? 'Failed to parse file.');
      }
    } catch {
      toast.error('Failed to upload file.');
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const save = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error('Title and content are required.');
      return;
    }
    setSaving(true);
    try {
      const isNew = editing === 'new';
      const res = await fetch(
        isNew ? '/api/ai/knowledge' : `/api/ai/knowledge/${editing}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), content: content.trim() }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        if (data.warning) toast.warning(data.warning);
        else toast.success(isNew ? 'Document added.' : 'Document updated.');
        cancelEdit();
        await fetchDocs();
      } else {
        toast.error(data.error ?? 'Failed to save.');
      }
    } catch {
      toast.error('Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Document removed.');
        setDocs((d) => d.filter((x) => x.id !== id));
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to remove.');
      }
    } catch {
      toast.error('Failed to remove.');
    }
  };

  const reindex = async () => {
    setReindexing(true);
    try {
      const res = await fetch('/api/ai/knowledge/reindex', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Reindexed ${data.reindexed} document(s).`);
      } else {
        toast.error(data.error ?? 'Reindex failed.');
      }
    } catch {
      toast.error('Reindex failed.');
    } finally {
      setReindexing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4 text-primary" /> Knowledge base
        </CardTitle>
        <CardDescription>
          Add FAQs, product details, uploaded documents, or web links. The assistant
          retrieves relevant knowledge chunks to accurately answer customer inquiries on WhatsApp.
          {hasEmbeddingsKey
            ? ' Semantic vector search is enabled.'
            : ' Using keyword search — add an embeddings key above for semantic vector search.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center py-4 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading documents…
          </div>
        ) : (
          <>
            {docs.length === 0 && editing === null && (
              <p className="text-sm text-muted-foreground">
                No documents added yet. Click &quot;Add document&quot; to import files, web links, or text.
              </p>
            )}

            {docs.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {docs.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between gap-2 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {doc.title}
                      </span>
                    </div>
                    {canEdit && (
                      <span className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => void openEdit(doc.id)}
                          title="Edit document"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => void remove(doc.id)}
                          title="Delete document"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {editing !== null ? (
              <div className="space-y-4 rounded-lg border border-border bg-card/50 p-4">
                {editing === 'new' && (
                  <div className="flex border-b border-border pb-3">
                    <div className="flex gap-1.5 rounded-lg bg-muted p-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setImportTab('text')}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                          importTab === 'text'
                            ? 'bg-background text-foreground shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <FileText className="h-3.5 w-3.5" /> Direct Text
                      </button>
                      <button
                        type="button"
                        onClick={() => setImportTab('file')}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                          importTab === 'file'
                            ? 'bg-background text-foreground shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Upload className="h-3.5 w-3.5" /> Upload File
                      </button>
                      <button
                        type="button"
                        onClick={() => setImportTab('url')}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                          importTab === 'url'
                            ? 'bg-background text-foreground shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Globe className="h-3.5 w-3.5" /> Import Web Link
                      </button>
                    </div>
                  </div>
                )}

                {editing === 'new' && importTab === 'url' ? (
                  <div className="space-y-3">
                    <Label htmlFor="kb-url">Web Page URL</Label>
                    <div className="flex gap-2">
                      <Input
                        id="kb-url"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder="https://example.com/faq-or-policy"
                        disabled={fetchingUrl}
                      />
                      <Button
                        type="button"
                        onClick={handleFetchUrl}
                        disabled={fetchingUrl || !urlInput.trim()}
                      >
                        {fetchingUrl ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Link className="mr-2 h-4 w-4" />
                        )}
                        Fetch & Extract
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Fetches page content, strips HTML navigation/ads, and extracts readable text into your document editor.
                    </p>
                  </div>
                ) : editing === 'new' && importTab === 'file' ? (
                  <div className="space-y-3">
                    <Label>Upload File (PDF, TXT, CSV, MD, JSON)</Label>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:border-primary/50 cursor-pointer"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.txt,.md,.markdown,.csv,.json"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                      {uploadingFile ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-5 w-5 animate-spin text-primary" /> Extracting document text…
                        </div>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                          <p className="text-sm font-medium text-foreground">
                            Click to select a file or drop document here
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Supports PDF, Plain Text (.txt), Markdown (.md), CSV, and JSON (up to 10 MB).
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}

                {(importTab === 'text' || title || content) && (
                  <div className="space-y-3 pt-1">
                    <div className="space-y-2">
                      <Label htmlFor="kb-title">Document Title</Label>
                      <Input
                        id="kb-title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Shipping Policy & Delivery Times"
                        disabled={saving}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="kb-content">Text Content</Label>
                      <Textarea
                        id="kb-content"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder="Paste document text, FAQs, or extracted product specifications…"
                        rows={8}
                        disabled={saving}
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="ghost" onClick={cancelEdit} disabled={saving}>
                        Cancel
                      </Button>
                      <Button onClick={save} disabled={saving || !title || !content}>
                        {saving ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle className="mr-2 h-4 w-4" />
                        )}
                        Save document
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              canEdit && (
                <div className="flex items-center justify-between pt-1">
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => openNew('text')}>
                      <Plus className="mr-2 h-4 w-4" /> Add Text
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openNew('file')}>
                      <Upload className="mr-2 h-4 w-4" /> Upload File
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openNew('url')}>
                      <Globe className="mr-2 h-4 w-4" /> Web Link
                    </Button>
                  </div>

                  {hasEmbeddingsKey && docs.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={reindex}
                      disabled={reindexing}
                      title="Re-embed all documents"
                    >
                      {reindexing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      Reindex
                    </Button>
                  )}
                </div>
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
