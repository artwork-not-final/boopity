import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const unexpectedResponse =
  "This page received an unexpected response. Please try again.";
const requestFailed = "The request could not be completed. Please try again.";

function retryAfterSeconds(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : value.endsWith("GMT")
      ? Math.ceil((Date.parse(value) - Date.now()) / 1000)
      : NaN;
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : undefined;
}

export function parseResponse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  context: { status: number; requestId?: string } = { status: 200 },
): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError(unexpectedResponse, context.status, context.requestId);
  return result.data;
}

export async function decodeResponse<T>(
  response: Response,
  schema?: z.ZodType<T>,
): Promise<T> {
  // A cancelled request must remain cancelled, including during body decoding.
  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
  }
  const object =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  const id = response.headers.get("x-request-id");
  const requestId = id && /^[a-zA-Z0-9-]{1,80}$/.test(id) ? id : undefined;
  if (!response.ok) {
    const message = object?.error ?? object?.message;
    throw new ApiError(
      typeof message === "string" && message.trim() && message.length <= 500
        ? message
        : requestFailed,
      response.status,
      requestId,
      retryAfterSeconds(response.headers.get("Retry-After")),
    );
  }
  // Boopity's JSON APIs always return objects. Empty/HTML/null success bodies
  // must never masquerade as valid data and fail later inside rendering.
  if (!object)
    throw new ApiError(unexpectedResponse, response.status, requestId);
  return schema
    ? parseResponse(schema, object, { status: response.status, requestId })
    : (object as T);
}
