import { Hono } from "hono";
import type { AppEnv } from "../core/env";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function sanitizeFileName(value: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  })();
  const name = decoded.split(/[\\/]/).pop() ?? "upload";
  return (
    name
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 120) || "upload"
  );
}

export const uploads = new Hono<AppEnv>();

uploads.get("/", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT id, file_name AS fileName, content_type AS contentType,
            size_bytes AS sizeBytes, created_at AS createdAt
       FROM upload_objects
      WHERE sitter_id = ?1
      ORDER BY created_at DESC
      LIMIT 50`,
  )
    .bind(c.get("sitterId"))
    .all();

  return c.json({ uploads: result.results });
});

uploads.put("/", async (c) => {
  const contentType = c.req
    .header("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  const declaredSize = Number(c.req.header("x-file-size"));
  if (!contentType || !ALLOWED_TYPES.has(contentType)) {
    return c.json({ error: "Use a PDF, JPEG, PNG, or WebP file" }, 415);
  }
  if (
    !Number.isFinite(declaredSize) ||
    declaredSize <= 0 ||
    declaredSize > MAX_UPLOAD_BYTES
  ) {
    return c.json({ error: "File size must be between 1 byte and 10 MB" }, 413);
  }
  if (!c.req.raw.body) {
    return c.json({ error: "The upload body is empty" }, 400);
  }

  const sitterId = c.get("sitterId");
  const id = crypto.randomUUID();
  const fileName = sanitizeFileName(c.req.header("x-file-name") ?? "upload");
  const objectKey = `${sitterId}/${id}/${fileName}`;
  const object = await c.env.UPLOADS.put(objectKey, c.req.raw.body, {
    httpMetadata: { contentType },
    customMetadata: { sitterId, originalName: fileName },
  });

  if (object.size !== declaredSize || object.size > MAX_UPLOAD_BYTES) {
    await c.env.UPLOADS.delete(objectKey);
    return c.json(
      { error: "Uploaded size did not match the declared size" },
      400,
    );
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO upload_objects
        (id, sitter_id, object_key, file_name, content_type, size_bytes, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
      .bind(
        id,
        sitterId,
        objectKey,
        fileName,
        contentType,
        object.size,
        Date.now(),
      )
      .run();
  } catch (error) {
    await c.env.UPLOADS.delete(objectKey);
    throw error;
  }

  return c.json({ id, fileName, contentType, sizeBytes: object.size }, 201);
});

uploads.get("/:id", async (c) => {
  const metadata = await c.env.DB.prepare(
    `SELECT object_key AS objectKey, file_name AS fileName, content_type AS contentType
       FROM upload_objects
      WHERE id = ?1 AND sitter_id = ?2
      LIMIT 1`,
  )
    .bind(c.req.param("id"), c.get("sitterId"))
    .first<{ objectKey: string; fileName: string; contentType: string }>();

  if (!metadata) {
    return c.json({ error: "Upload not found" }, 404);
  }

  const object = await c.env.UPLOADS.get(metadata.objectKey);
  if (!object?.body) {
    return c.json({ error: "Upload data is missing" }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", metadata.contentType);
  headers.set(
    "content-disposition",
    `inline; filename="${metadata.fileName.replace(/["\\]/g, "_")}"`,
  );
  headers.set("cache-control", "private, no-store");
  return new Response(object.body, { headers });
});
