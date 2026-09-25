import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv, Bindings } from "../worker/env";
import { petPhotosApi } from "../worker/pet-photos";
import { testDatabase } from "./database";

describe("deferred pet-photo prototype (not mounted by Node)", () => {
  let database: ReturnType<typeof testDatabase>,
    env: Bindings,
    objects: Map<string, Uint8Array>;
  const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("sitterId", "sitter-a");
    await next();
  });
  app.route("/api/pets", petPhotosApi);
  const upload = (body = image, size = body.length, pet = "pet-a") =>
    app.request(
      `/api/pets/${pet}/photo`,
      {
        method: "PUT",
        headers: {
          "content-type": "image/png",
          "x-file-size": String(size),
          "x-file-name": "photo.png",
        },
        body,
      },
      env,
    );
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
          return bytes
            ? {
                body: bytes,
                writeHttpMetadata: (headers: Headers) =>
                  headers.set("content-type", "image/png"),
              }
            : null;
        }),
        delete: vi.fn(async (key: string) => {
          objects.delete(key);
        }),
      },
    } as unknown as Bindings;
  });
  afterEach(() => database.sqlite.close());
  it("validates actual bytes and file signatures before R2 writes", async () => {
    expect((await upload(image, 1)).status).toBe(413);
    expect((await upload(new TextEncoder().encode("<html>"))).status).toBe(415);
    expect((await upload(image, image.length + 1)).status).toBe(400);
    expect((await upload(image, image.length, "pet-b")).status).toBe(404);
    expect(env.UPLOADS.put).not.toHaveBeenCalled();
  });
  it("round-trips a private image with no-store caching", async () => {
    expect((await upload()).status).toBe(200);
    const response = await app.request("/api/pets/pet-a/photo", {}, env);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(image);
    expect((await app.request("/api/pets/pet-b/photo", {}, env)).status).toBe(
      404,
    );
  });
  it("cleans the new R2 object after a failed metadata write", async () => {
    database.sqlite.exec(
      "CREATE TRIGGER fail_photo BEFORE UPDATE ON pets BEGIN SELECT RAISE(ABORT, 'simulated failure'); END",
    );
    expect((await upload()).status).toBe(500);
    expect(objects.size).toBe(0);
  });
  it("does not overwrite a concurrent photo update", async () => {
    vi.mocked(env.UPLOADS.put).mockImplementationOnce(async (key, bytes) => {
      objects.set(key, bytes as Uint8Array);
      database.sqlite.exec(
        "UPDATE pets SET photo_object_key = 'concurrent' WHERE id = 'pet-a'",
      );
      return { size: image.length };
    });
    expect((await upload()).status).toBe(409);
    expect(objects.size).toBe(0);
    expect(
      database.sqlite
        .prepare("SELECT photo_object_key FROM pets WHERE id = 'pet-a'")
        .get()?.photo_object_key,
    ).toBe("concurrent");
  });
});
