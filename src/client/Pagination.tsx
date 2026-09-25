import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Choice } from "./Choice";
import { workspaceApi } from "./workspace-api";
import { createLiveSearch, showSearchInput } from "./live-search";
import { PAGE_SIZE, type Pagination } from "../shared/pagination";
export { compactPage, VISIBLE_PAGE_SIZE } from "./compact-page";

export function usePage<T>(path: string, revision: number, enabled = true) {
  const [query, setQuery] = useState({ search: "", offset: 0 }),
    [retry, setRetry] = useState(0),
    [state, setState] = useState<{
      key: string;
      data?: T & { pagination: Pagination };
      error?: string;
    }>({ key: "" });
  const key = `${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ search: query.search, offset: String(query.offset) })}`;
  const requestKey = `${key}:${revision}:${retry}`;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void workspaceApi<T & { pagination: Pagination }>(
      key,
      "GET",
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setState({ key: requestKey, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            key: requestKey,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load this list.",
          });
      });
    return () => controller.abort();
  }, [requestKey, key, enabled]);
  const current = state.key === requestKey ? state : null;
  return {
    data: current?.data,
    error: current?.error,
    loading: !current,
    offset: query.offset,
    term: query.search,
    search: (search: string) => setQuery({ offset: 0, search }),
    reset: () => setQuery((q) => ({ ...q, offset: 0 })),
    go: (offset: number) => setQuery((q) => ({ ...q, offset })),
    retry: () => setRetry((n) => n + 1),
  };
}
export function SearchBox({
  label,
  onSearch,
  initialValue = "",
  showWhen = true,
  className = "",
}: {
  label: string;
  onSearch: (text: string) => void;
  initialValue?: string;
  showWhen?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(initialValue);
  const [focused, setFocused] = useState(false);
  const callback = useRef(onSearch);
  useEffect(() => {
    callback.current = onSearch;
  }, [onSearch]);
  const [search] = useState(() =>
    createLiveSearch((text) => callback.current(text), initialValue),
  );
  useEffect(() => () => search.cancel(), [search]);
  const id = useId();
  if (!showSearchInput(showWhen, focused, draft)) return null;
  return (
    <div className={`space-y-2 ${className}`}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        type="search"
        className="min-h-11 bg-card"
        enterKeyHint="search"
        maxLength={100}
        value={draft}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setDraft(e.target.value);
          search.change(e.target.value);
        }}
        onCompositionStart={() => search.startComposition()}
        onCompositionEnd={(e) => search.endComposition(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.nativeEvent.isComposing &&
            e.nativeEvent.keyCode !== 229
          ) {
            e.preventDefault();
            search.flush(e.currentTarget.value);
          }
        }}
      />
    </div>
  );
}
export function PageControls({
  label,
  pagination,
  offset,
  loading,
  error,
  go,
  retry,
}: {
  label: string;
  pagination?: Pagination;
  offset: number;
  loading?: boolean;
  error?: string;
  go: (offset: number) => void;
  retry?: () => void;
}) {
  const limit = pagination?.limit ?? PAGE_SIZE;
  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}{" "}
          {retry && (
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              Retry list
            </Button>
          )}
        </p>
      )}
      <nav
        aria-label={`${label} pages`}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <Button
          type="button"
          variant="outline"
          disabled={loading || offset === 0}
          onClick={() => go(Math.max(0, offset - limit))}
          aria-label={`Previous ${label} page`}
        >
          Previous
        </Button>
        <span role="status" className="text-xs text-muted-foreground">
          {loading ? "Loading…" : `Page ${Math.floor(offset / limit) + 1}`}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={loading || !pagination?.hasMore}
          onClick={() => go(offset + limit)}
          aria-label={`Next ${label} page`}
        >
          Next
        </Button>
      </nav>
    </div>
  );
}
export function PagedSelect<T extends { id: string }>({
  label,
  path,
  collection,
  selected,
  onSelect,
  describe,
  revision,
  compact = false,
  disabled = false,
}: {
  label: string;
  path: string;
  collection: string;
  selected: T | null;
  onSelect: (value: T | null) => void;
  describe: (value: T) => string;
  revision: number;
  compact?: boolean;
  disabled?: boolean;
}) {
  const page = usePage<Record<string, T[]>>(path, revision),
    id = useId();
  const rows = page.data?.[collection] ?? [];
  return (
    <div
      className={
        compact ? "min-w-0 space-y-3" : "space-y-3 rounded-xl border p-4"
      }
    >
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <Choice
        id={id}
        required
        disabled={disabled}
        searchable
        searchLabel={`Find ${label.toLowerCase()}`}
        searchValue={page.term}
        onSearchChange={page.search}
        loading={page.loading}
        placeholder={`Choose ${label.toLowerCase()}`}
        selectedLabel={selected ? describe(selected) : undefined}
        value={selected?.id ?? ""}
        onValueChange={(value) =>
          onSelect(rows.find((row) => row.id === value) ?? null)
        }
        options={rows.map((row) => ({ value: row.id, label: describe(row) }))}
        footer={
          page.error || page.offset > 0 || page.data?.pagination.hasMore ? (
            <PageControls
              label={label.toLowerCase()}
              {...page}
              pagination={page.data?.pagination}
            />
          ) : undefined
        }
      />
      {selected && !compact && (
        <p className="break-words text-xs text-muted-foreground">
          Selected: {describe(selected)}
        </p>
      )}
    </div>
  );
}
