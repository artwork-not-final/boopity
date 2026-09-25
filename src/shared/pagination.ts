import { z } from "zod";

export const PAGE_SIZE = 50;
export const pageOffset = z.coerce
  .number()
  .int()
  .min(0)
  .max(2_147_483_647)
  .default(0);
export const listQuery = z.object({
  offset: pageOffset,
  search: z.string().trim().max(100).default(""),
});
export type Pagination = { offset: number; limit: number; hasMore: boolean };
export function pageInfo(offset: number, count: number): Pagination {
  return { offset, limit: PAGE_SIZE, hasMore: count > PAGE_SIZE };
}
/** User search is literal text, not SQL wildcard syntax. Values are still bound parameters. */
export function searchPattern(search: string) {
  return `%${search.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
}
