import { Check, Pencil, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface MemoryItem {
  id: string;
  content?: string;
  memory?: string;
  tags?: string | string[];
  similarity?: number;
  createdAt?: number;
  containerTag?: string;
}

interface MemoriesResponse {
  memories: MemoryItem[];
}

interface SearchResponse {
  results: MemoryItem[];
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function parseTags(tags?: string | string[]): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.filter(Boolean);
  return tags.split(",").map((t) => t.trim()).filter(Boolean);
}

function App() {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const url = q ? `/api/search?q=${encodeURIComponent(q)}` : "/api/memories";
      const res = await fetch(url);
      const data: MemoriesResponse & SearchResponse = await res.json();
      setItems(data.results || data.memories || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => load(value), 300);
    },
    [load],
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
    }
  };

  const startEdit = (item: MemoryItem) => {
    setEditingId(item.id);
    setEditContent(item.content || item.memory || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  const saveEdit = async (id: string) => {
    if (!editContent.trim()) return;
    try {
      await fetch(`/api/memories/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      setEditingId(null);
      setEditContent("");
      load(query);
    } catch {
      /* ignore */
    }
  };

  const deleteSingle = async (id: string) => {
    try {
      await fetch(`/api/memories/${id}`, { method: "DELETE" });
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      load(query);
    } catch {
      /* ignore */
    }
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    try {
      await fetch("/api/memories/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      setSelectedIds(new Set());
      load(query);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-8 flex items-center gap-3">
          <svg viewBox="0 0 48 48" fill="none" className="h-8 w-8">
            <path
              d="M24 4C18 4 12 8 12 14c0 3 1.5 5.5 3.5 7.5C13 26 10 31 10 36c0 5 4 8 8 8h12c4 0 8-3 8-8 0-5-3-10-5.5-14.5C34.5 19.5 36 17 36 14c0-6-6-10-12-10z"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M18 24c0 4 2 8 6 8s6-4 6-8-2-8-6-8-6 4-6 8z"
              fill="currentColor"
              opacity="0.15"
            />
            <path
              d="M20 28c0 2 1.5 4 4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">brain</h1>
            <p className="text-muted-foreground text-sm">memory browser</p>
          </div>
        </div>

        <div className="relative mb-4">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search memories..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {selectedIds.size > 0 && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2">
            <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
            <button
              onClick={deleteSelected}
              className="ml-auto flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete selected
            </button>
          </div>
        )}

        {loading && items.length === 0 && (
          <p className="text-muted-foreground text-center text-sm">Loading...</p>
        )}

        {!loading && items.length === 0 && (
          <p className="text-muted-foreground text-center text-sm">No memories found.</p>
        )}

        <div className="space-y-3">
          {items.length > 0 && (
            <div className="flex items-center gap-2 px-1">
              <input
                type="checkbox"
                checked={selectedIds.size === items.length && items.length > 0}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-xs text-muted-foreground">
                {selectedIds.size === items.length ? "Deselect all" : "Select all"} ({items.length})
              </span>
            </div>
          )}
          {items.map((item) => {
            const isEditing = editingId === item.id;
            return (
              <Card
                key={item.id}
                className={selectedIds.has(item.id) ? "ring-1 ring-primary" : ""}
              >
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-border"
                    />
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
                            rows={4}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEdit(item.id)}
                              className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="flex items-center gap-1 rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-accent"
                            >
                              <X className="h-3.5 w-3.5" />
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="mb-2 text-sm leading-relaxed whitespace-pre-wrap break-words">
                          {(item.content || item.memory || "")}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{item.id}</span>
                        {item.similarity !== undefined && (
                          <Badge variant="secondary">{(item.similarity * 100).toFixed(0)}%</Badge>
                        )}
                        {item.createdAt && <span>{formatDate(item.createdAt)}</span>}
                        {parseTags(item.tags).map((tag) => (
                          <Badge key={tag} variant="outline">
                            {tag}
                          </Badge>
                        ))}
                        <div className="ml-auto flex gap-1">
                          <button
                            onClick={() => startEdit(item)}
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => deleteSingle(item.id)}
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default App;