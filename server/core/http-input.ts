import type { HonoRequest } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";

const invalidInput = () =>
  new HTTPException(400, {
    message: "Check the entered values and try again.",
  });

// Only request-boundary validation belongs here. Stored settings and provider
// responses must fail as server errors, not as invalid input from the sitter.
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw invalidInput();
  return result.data;
}

export async function readJson(request: HonoRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw invalidInput();
    throw error;
  }
}
