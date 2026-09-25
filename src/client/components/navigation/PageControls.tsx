import { Button } from "../ui/button";

import { PAGE_SIZE, type Pagination } from "../../../shared/pagination";

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
