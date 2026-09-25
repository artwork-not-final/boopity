import { decodeResponse } from "./api-response";
import type { z } from "zod";
export { ApiError as WorkspaceError } from "./api-response";
export async function workspaceApi<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
  schema?: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(`/api/business${path}`, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    signal,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return decodeResponse<T>(response, schema);
}
