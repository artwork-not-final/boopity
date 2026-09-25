import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupIncompleteUploads,
  documentsApi,
  matchesFileType,
} from "../../server/experimental/documents";
import type { AppEnv, Bindings } from "../../server/core/env";
import { testApp, testDatabase } from "../support/database";

describe("private documents", () => {
  let database: ReturnType<typeof testDatabase>,
    env: Bindings,
    objects: Map<string, Uint8Array>;
  const json = testApp(documentsApi, "/api/documents");
  const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const details = {
    title: "Scout vaccination",
    category: "vaccination",
    clientId: "client-a",
    petId: "pet-a",
    description: "Private record",
  };
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("sitterId", c.req.header("x-test-sitter") ?? "sitter-a");
    await next();
  });
  app.route("/api/documents", documentsApi);
  async function upload(
    metadata: unknown = details,
    body = image,
    size = body.byteLength,
    type = "image/png",
  ) {
    return app.request(
      "/api/documents",
      {
        method: "POST",
        headers: {
          "content-type": type,
          "x-file-size": String(size),
          "x-file-name": encodeURIComponent("../../Scout vaccine.png"),
          "x-document-metadata": encodeURIComponent(JSON.stringify(metadata)),
        },
        body,
      },
      env,
    );
  }
  beforeEach(() => {
    database = testDatabase();
    objects = new Map();
    database.sqlite.exec(
      "INSERT INTO pets (id, client_id, name, created_at, updated_at) VALUES ('pet-a', 'client-a', 'Scout', 0, 0), ('pet-b', 'client-b', 'Poppy', 0, 0)",
    );
    env = {
      DB: database.db,
      UPLOADS: {
        put: vi.fn(async (key: string, bytes: Uint8Array) => {
          objects.set(key, bytes);
          return { size: bytes.length };
        }),
        get: vi.fn(async (key: string) => {
          const bytes = objects.get(key);
          return bytes ? { body: bytes, size: bytes.length } : null;
        }),
        delete: vi.fn(async (key: string) => {
          objects.delete(key);
        }),
      },
    } as unknown as Bindings;
  });
  afterEach(() => database.sqlite.close());

  it("round-trips an owned file privately, infers the household from its pet, and filters by metadata", async () => {
    const response = await upload({ ...details, clientId: null });
    expect(response.status).toBe(201);
    const { document } = await response.json();
    expect(document).toMatchObject({
      clientId: "client-a",
      petId: "pet-a",
      title: details.title,
      fileName: "Scout-vaccine.png",
      sizeBytes: image.length,
    });
    const downloaded = await app.request(
      `/api/documents/${document.id}/download`,
      {},
      env,
    );
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
    expect(downloaded.headers.get("content-disposition")).toContain(
      "attachment;",
    );
    expect(downloaded.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(image);
    expect(
      (
        await json("?petId=pet-a&category=vaccination&search=Scout", env).then(
          (r) => r.json(),
        )
      ).documents,
    ).toHaveLength(1);
    expect(
      (await json("?category=agreement", env).then((r) => r.json())).documents,
    ).toHaveLength(0);
  });

  it("enforces ownership on upload, download, edits, archive, and restore", async () => {
    for (const metadata of [
      { ...details, clientId: "client-b" },
      { ...details, petId: "pet-b" },
    ])
      expect((await upload(metadata)).status).toBe(404);
    const { document } = await upload().then((r) => r.json());
    for (const path of [`/${document.id}`, `/${document.id}/download`])
      expect((await json(path, env, "GET", undefined, "b")).status).toBe(404);
    expect(
      (
        await json(
          `/${document.id}`,
          env,
          "PUT",
          { ...details, version: 1 },
          "b",
        )
      ).status,
    ).toBe(404);
    expect(
      (await json(`/${document.id}/archive`, env, "POST", { version: 1 }, "b"))
        .status,
    ).toBe(404);
    expect(
      (await json(`/${document.id}/restore`, env, "POST", { version: 1 }, "b"))
        .status,
    ).toBe(404);
    expect(
      (await json("", env, "GET", undefined, "b").then((r) => r.json()))
        .documents,
    ).toEqual([]);
  });

  it("preserves archived files and rejects stale metadata changes", async () => {
    const { document } = await upload().then((r) => r.json());
    const update = { ...details, title: "Updated record", version: 1 };
    expect((await json(`/${document.id}`, env, "PUT", update)).status).toBe(
      200,
    );
    expect((await json(`/${document.id}`, env, "PUT", update)).status).toBe(
      409,
    );
    expect(
      (await json(`/${document.id}/archive`, env, "POST", { version: 2 }))
        .status,
    ).toBe(200);
    expect((await json("", env).then((r) => r.json())).documents).toHaveLength(
      0,
    );
    expect(
      (await json("?archived=true", env).then((r) => r.json())).documents,
    ).toHaveLength(1);
    expect(
      (await json(`/${document.id}`, env, "PUT", { ...update, version: 3 }))
        .status,
    ).toBe(409);
    expect(
      (await json(`/${document.id}/restore`, env, "POST", { version: 3 }))
        .status,
    ).toBe(200);
    expect(objects.size).toBe(1);
  });

  it("rejects spoofed types and bounds the actual bytes before writing R2", async () => {
    expect(
      (
        await upload(
          details,
          new TextEncoder().encode("<script>alert(1)</script>"),
        )
      ).status,
    ).toBe(415);
    expect((await upload(details, image, 1)).status).toBe(413);
    expect((await upload(details, image, image.length + 1)).status).toBe(400);
    expect((await upload(details, image, 10 * 1024 * 1024 + 1)).status).toBe(
      413,
    );
    expect(
      (await upload(details, image, image.length, "text/html")).status,
    ).toBe(415);
    expect(env.UPLOADS.put).not.toHaveBeenCalled();
    expect(
      matchesFileType(new TextEncoder().encode("%PDF-1.4"), "application/pdf"),
    ).toBe(true);
    expect(matchesFileType(new Uint8Array([255, 216, 255]), "image/jpeg")).toBe(
      true,
    );
    expect(
      matchesFileType(new TextEncoder().encode("RIFF0000WEBP"), "image/webp"),
    ).toBe(true);
  });

  it("cleans failed uploads and preserves reservations when storage cleanup also fails", async () => {
    database.sqlite.exec(
      "CREATE TRIGGER fail_ready BEFORE UPDATE ON upload_objects WHEN NEW.upload_status = 'ready' BEGIN SELECT RAISE(ABORT, 'fail ready'); END",
    );
    expect((await upload()).status).toBe(502);
    expect(objects.size).toBe(0);
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM upload_objects")
        .get()?.count,
    ).toBe(0);
    vi.mocked(env.UPLOADS.delete).mockRejectedValueOnce(
      new Error("R2 unavailable"),
    );
    expect((await upload()).status).toBe(502);
    expect(objects.size).toBe(1);
    expect((await json("", env).then((r) => r.json())).documents).toHaveLength(
      0,
    );
    const row = database.sqlite.prepare("SELECT id FROM upload_objects").get()!;
    expect((await json(`/${row.id}/download`, env)).status).toBe(404);
    await cleanupIncompleteUploads(env, Date.now() + 3_600_001);
    expect(objects.size).toBe(0);
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM upload_objects")
        .get()?.count,
    ).toBe(0);
  });
});
