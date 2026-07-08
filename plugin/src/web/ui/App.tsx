import { Search } from "lucide-react";
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

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-8 space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">brain</h1>
          <p className="text-muted-foreground text-sm">memory browser</p>
        </div>

        <div className="relative mb-6">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search memories..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {loading && items.length === 0 && (
          <p className="text-muted-foreground text-center text-sm">Loading...</p>
        )}

        {!loading && items.length === 0 && (
          <p className="text-muted-foreground text-center text-sm">No memories found.</p>
        )}

        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="p-4">
                <p className="mb-2 text-sm leading-relaxed">
                  {(item.content || item.memory || "").substring(0, 200)}
                </p>
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
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
