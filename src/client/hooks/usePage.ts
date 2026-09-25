import { useEffect, useState } from "react";

import { workspaceApi } from "../lib/http/workspace-api";

import { type Pagination } from "../../shared/pagination";

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
