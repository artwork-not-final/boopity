import { decodeResponse } from "./api-response";

export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: {
      ...(body !== undefined && !(body instanceof File)
        ? { "content-type": "application/json" }
        : {}),
      ...headers,
    },
    ...(body !== undefined
      ? { body: body instanceof File ? body : JSON.stringify(body) }
      : {}),
  });
  return decodeResponse<T>(response);
}
