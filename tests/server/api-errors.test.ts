import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  workspaceApi,
  WorkspaceError,
} from "../../src/client/lib/http/workspace-api";
import { decodeResponse } from "../../src/client/lib/http/api-response";
import { handleRequestError } from "../../platform/http-errors";
import { parseInput, readJson } from "../../platform/http-input";
import { createNodeApp } from "../../platform/node/app";
import { loadConfig } from "../../platform/node/runtime";
import { clientsApi } from "../../worker/clients";
import { testApp, testDatabase } from "../support/database";
import type { AppEnv, Bindings } from "../../worker/env";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("API response boundaries", () => {
  it.each([
    ["339", 339],
    ["0", 0],
    ["Tue, 22 Sep 2026 14:21:15 GMT", 339],
    ["", undefined],
    ["-1", undefined],
    ["1.5", undefined],
    ["Infinity", undefined],
    ["tomorrow", undefined],
    ["99999999999999999999999", undefined],
    ["Tue, 22 Sep 2026 13:00:00 GMT", undefined],
  ])("retains a valid Retry-After deadline (%s)", async (header, expected) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T14:15:36Z"));
    await expect(
      decodeResponse(
        Response.json(
          { message: "Please wait." },
          {
            status: 429,
            headers: { "Retry-After": header!, "x-request-id": "test-request" },
          },
        ),
      ),
    ).rejects.toMatchObject({
      status: 429,
      requestId: "test-request",
      retryAfterSeconds: expected,
    });
  });
  it.each(["<html>Proxy failure</html>", "", "null", "[]", '"unexpected"'])(
    "rejects invalid successful JSON objects: %s",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(body)),
      );
      await expect(workspaceApi("/policy")).rejects.toMatchObject({
        status: 200,
        message: expect.stringContaining("unexpected response"),
      });
    },
  );
  it.each([null, [], { error: { private: "details" } }, { message: 42 }])(
    "keeps the HTTP status with an unusable error body: %j",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json(body, {
            status: 401,
            headers: { "x-request-id": "synthetic-request-id" },
          }),
        ),
      );
      const error = await workspaceApi("/policy").catch(
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(WorkspaceError);
      expect(error).toMatchObject({
        status: 401,
        requestId: "synthetic-request-id",
        message: expect.stringContaining("try again"),
      });
      expect(String(error)).not.toContain("private");
    },
  );
  it("preserves safe user-facing errors and handles non-JSON failures", async () => {
    await expect(
      decodeResponse(
        Response.json({ error: "Refresh before saving." }, { status: 409 }),
      ),
    ).rejects.toMatchObject({ status: 409, message: "Refresh before saving." });
    await expect(
      decodeResponse(
        new Response("<html>Gateway down</html>", { status: 502 }),
      ),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("try again"),
    });
  });
  it("preserves cancellation during fetch and body decoding", async () => {
    const abort = new DOMException("Request cancelled", "AbortError");
    const controller = new AbortController();
    const fetch = vi.fn(async (_path: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      throw abort;
    });
    vi.stubGlobal("fetch", fetch);
    await expect(
      workspaceApi("/policy", "GET", undefined, controller.signal),
    ).rejects.toBe(abort);
    const response = Response.json({});
    vi.spyOn(response, "json").mockRejectedValue(abort);
    await expect(decodeResponse(response)).rejects.toBe(abort);
  });
  it("keeps HTTP context when reading a failed response body fails", async () => {
    const response = new Response(null, { status: 503 });
    vi.spyOn(response, "json").mockRejectedValue(
      new TypeError("Private stream details"),
    );
    await expect(decodeResponse(response)).rejects.toMatchObject({
      status: 503,
      message: "The request could not be completed. Please try again.",
    });
  });
  it("keeps correlation information when a successful body violates its schema", async () => {
    const response = Response.json(
      {},
      { headers: { "x-request-id": "synthetic-request-id" } },
    );
    await expect(
      decodeResponse(response, z.object({ name: z.string() })),
    ).rejects.toMatchObject({
      status: 200,
      requestId: "synthetic-request-id",
      message: expect.stringContaining("unexpected response"),
    });
  });
});

describe("private server diagnostics", () => {
  it.each([
    new Error("secret-key private@example.test"),
    new SyntaxError("private stored JSON"),
    z.object({ name: z.string() }).safeParse({}).error!,
  ])(
    "classifies internal errors as server failures without exposing details",
    async (failure) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const env = {
        DB: {
          prepare: () => {
            throw failure;
          },
        },
      } as unknown as Bindings;
      const app = createNodeApp(
        env,
        loadConfig({ APP_URL: "http://localhost:3000" }),
      );
      const response = await app.request(
        "http://localhost:3000/api/ready?token=private-token",
        {
          headers: {
            "x-request-id": "untrusted-correlation-id",
            authorization: "Bearer private-key",
          },
        },
      );
      expect(response.status).toBe(500);
      const requestId = response.headers.get("x-request-id");
      expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
      expect(await response.json()).toEqual({
        error: "The server couldn't complete that request. Please try again.",
        requestId,
      });
      expect(log).toHaveBeenCalledOnce();
      expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
        event: "http.error",
        requestId,
        method: "GET",
        route: "/api/ready",
        status: 500,
      });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(
        /private|secret-key|untrusted|authorization|token=/,
      );
    },
  );
  it("logs only route patterns, not identifiers, and redacts 5xx exception messages", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = new Hono<AppEnv>();
    app.onError(handleRequestError);
    app.get("/clients/:id", () => {
      throw new HTTPException(503, { message: "PRIVATE provider failure" });
    });
    const response = await app.request(
      "/clients/private-client?key=private-key",
    );
    expect(response.status).toBe(503);
    expect(JSON.parse(log.mock.calls[0][0]).route).toBe("/clients/:id");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|private/);
    expect(await response.text()).not.toMatch(/PRIVATE|private/);
  });
  it.each(["{bad-json", "null", '{"name":4}'])(
    "keeps malformed request input as 400: %s",
    async (body) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const app = new Hono<AppEnv>();
      app.onError(handleRequestError);
      app.post("/input", async (c) =>
        c.json(
          parseInput(z.object({ name: z.string() }), await readJson(c.req)),
        ),
      );
      const response = await app.request("/input", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Check the entered values and try again.",
      });
      expect(log).not.toHaveBeenCalled();
    },
  );
});

it("reports stale client state without selling self-hosted sitters an upgrade", async () => {
  const fixture = testDatabase();
  try {
    const env = { DB: fixture.db, SELF_HOSTED: true } as Bindings;
    const request = testApp(clientsApi, "/clients");
    const active = await request("/client-a/reactivate", env, "POST", {});
    expect(active.status).toBe(409);
    expect(await active.text()).toContain("already active");
    expect(
      (await request("/client-b/reactivate", env, "POST", {})).status,
    ).toBe(404);
    fixture.sqlite.exec(
      "UPDATE clients SET status='archived' WHERE id='client-a'",
    );
    expect(
      (await request("/client-a/reactivate", env, "POST", {})).status,
    ).toBe(200);
  } finally {
    fixture.sqlite.close();
  }
});
