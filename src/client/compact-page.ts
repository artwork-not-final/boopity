import type { Pagination } from "../shared/pagination";

// The API still returns a bounded batch. Advance by the number actually shown,
// so compact lists neither skip records nor require a server pagination change.
export const VISIBLE_PAGE_SIZE = 10;
export function compactPage(pagination: Pagination | undefined, count: number) {
  return (
    pagination && {
      ...pagination,
      limit: VISIBLE_PAGE_SIZE,
      hasMore: count > VISIBLE_PAGE_SIZE || pagination.hasMore,
    }
  );
}
