// Deferred prototype: not mounted by the Node application. See API-ROUTES.md.
import { Hono } from "hono";
import type { QueryResult } from "../core/contracts";
import type { AppEnv } from "../core/env";
import { sanitizeFileName } from "./uploads";
import { readBoundedBody } from "./security";
import { matchesFileType } from "./documents";

const MAX_PET_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const petPhotosApi = new Hono<AppEnv>();

petPhotosApi.put("/:id/photo", async (c) => {
  const sitterId = c.get("sitterId");
  const petId = c.req.param("id");
  const contentType = c.req
    .header("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  const declaredSize = Number(c.req.header("x-file-size"));
  if (!contentType || !PHOTO_TYPES.has(contentType)) {
    return c.json({ error: "Use a JPEG, PNG, or WebP image" }, 415);
  }
  if (
    !Number.isInteger(declaredSize) ||
    declaredSize <= 0 ||
    declaredSize > MAX_PET_PHOTO_BYTES
  ) {
    return c.json({ error: "Photo size must be between 1 byte and 5 MB" }, 413);
  }
  if (!c.req.raw.body) return c.json({ error: "The photo body is empty" }, 400);

  const existing = await c.env.DB.prepare(
    `SELECT p.photo_object_key AS photoObjectKey
       FROM pets p JOIN clients c ON c.id = p.client_id
      WHERE p.id = ?1 AND c.sitter_id = ?2 AND c.status <> 'archived' LIMIT 1`,
  )
    .bind(petId, sitterId)
    .first<{ photoObjectKey: string | null }>();
  if (!existing) return c.json({ error: "Pet not found" }, 404);

  const bytes = await readBoundedBody(c.req.raw, declaredSize);
  if (bytes.length !== declaredSize)
    return c.json(
      { error: "Uploaded size did not match the declared size" },
      400,
    );
  if (!matchesFileType(bytes, contentType))
    return c.json(
      { error: "The photo contents do not match its image type" },
      415,
    );

  const fileName = sanitizeFileName(c.req.header("x-file-name") ?? "pet-photo");
  const objectKey = `pet-photos/${sitterId}/${petId}/${crypto.randomUUID()}-${fileName}`;
  await c.env.UPLOADS.put(objectKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: { sitterId, petId },
  });
  let updated: QueryResult;
  try {
    updated = await c.env.DB.prepare(
      `UPDATE pets SET photo_object_key = ?1, updated_at = ?2
      WHERE id = ?3 AND photo_object_key IS ?5 AND client_id IN (SELECT id FROM clients WHERE sitter_id = ?4 AND status <> 'archived')`,
    )
      .bind(objectKey, Date.now(), petId, sitterId, existing.photoObjectKey)
      .run();
  } catch (error) {
    await c.env.UPLOADS.delete(objectKey);
    throw error;
  }
  if (updated.meta.changes === 0) {
    await c.env.UPLOADS.delete(objectKey);
    return c.json(
      { error: "Pet photo changed. Reload before trying again." },
      409,
    );
  }
  if (existing.photoObjectKey)
    await c.env.UPLOADS.delete(existing.photoObjectKey);
  return c.json({ photoUrl: `/api/pets/${petId}/photo` });
});

petPhotosApi.get("/:id/photo", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT p.photo_object_key AS objectKey
       FROM pets p JOIN clients c ON c.id = p.client_id
      WHERE p.id = ?1 AND c.sitter_id = ?2 LIMIT 1`,
  )
    .bind(c.req.param("id"), c.get("sitterId"))
    .first<{ objectKey: string | null }>();
  if (!row?.objectKey) return c.json({ error: "Pet photo not found" }, 404);
  const object = await c.env.UPLOADS.get(row.objectKey);
  if (!object?.body) return c.json({ error: "Pet photo data is missing" }, 404);
  const headers = new Headers({
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  object.writeHttpMetadata(headers);
  return new Response(object.body, { headers });
});

petPhotosApi.delete("/:id/photo", async (c) => {
  const sitterId = c.get("sitterId");
  const petId = c.req.param("id");
  const existing = await c.env.DB.prepare(
    `SELECT p.photo_object_key AS objectKey
       FROM pets p JOIN clients c ON c.id = p.client_id
      WHERE p.id = ?1 AND c.sitter_id = ?2 LIMIT 1`,
  )
    .bind(petId, sitterId)
    .first<{ objectKey: string | null }>();
  if (!existing) return c.json({ error: "Pet not found" }, 404);
  const removed = await c.env.DB.prepare(
    `UPDATE pets SET photo_object_key = NULL, updated_at = ?1
      WHERE id = ?2 AND photo_object_key IS ?4 AND client_id IN (SELECT id FROM clients WHERE sitter_id = ?3)`,
  )
    .bind(Date.now(), petId, sitterId, existing.objectKey)
    .run();
  if (!removed.meta.changes)
    return c.json(
      { error: "Pet photo changed. Reload before trying again." },
      409,
    );
  if (existing.objectKey) await c.env.UPLOADS.delete(existing.objectKey);
  return c.body(null, 204);
});
