import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Bindings } from "./env";
import { MAX_UPLOAD_BYTES, sanitizeFileName } from "./uploads";
import { validationMessage } from "./domain";

const documentCategory = z.enum([
  "vaccination",
  "agreement",
  "care",
  "insurance",
  "other",
]);
export const documentInput = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).default(""),
  category: documentCategory.default("other"),
  clientId: z.string().min(1).nullable().default(null),
  petId: z.string().min(1).nullable().default(null),
});
const selection = `SELECT d.id, CASE WHEN d.title = '' THEN d.file_name ELSE d.title END AS title,
  d.description, d.category, d.client_id AS clientId, d.pet_id AS petId, d.file_name AS fileName,
  d.content_type AS contentType, d.size_bytes AS sizeBytes, d.archived_at AS archivedAt,
  d.created_at AS createdAt, d.updated_at AS updatedAt, d.version,
  c.first_name || ' ' || c.last_name AS clientName, p.name AS petName
  FROM upload_objects d LEFT JOIN clients c ON c.id = d.client_id LEFT JOIN pets p ON p.id = d.pet_id`;
const types = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

export function matchesFileType(bytes: Uint8Array, type: string) {
  const starts = (values: number[]) =>
    values.every((value, index) => bytes[index] === value);
  return type === "application/pdf"
    ? starts([37, 80, 68, 70, 45])
    : type === "image/png"
      ? starts([137, 80, 78, 71, 13, 10, 26, 10])
      : type === "image/jpeg"
        ? starts([255, 216, 255])
        : type === "image/webp"
          ? starts([82, 73, 70, 70]) &&
            [87, 69, 66, 80].every((n, i) => bytes[8 + i] === n)
          : false;
}

async function ownership(
  env: Bindings,
  sitter: string,
  value: z.infer<typeof documentInput>,
) {
  if (value.petId) {
    const pet = await env.DB.prepare(
      `SELECT p.client_id AS clientId FROM pets p JOIN clients c ON c.id = p.client_id
      WHERE p.id = ?1 AND c.sitter_id = ?2`,
    )
      .bind(value.petId, sitter)
      .first<{ clientId: string }>();
    if (!pet || (value.clientId && value.clientId !== pet.clientId))
      return false;
    value.clientId = pet.clientId;
  }
  if (
    value.clientId &&
    !(await env.DB.prepare(
      "SELECT id FROM clients WHERE id = ?1 AND sitter_id = ?2",
    )
      .bind(value.clientId, sitter)
      .first())
  )
    return false;
  return true;
}

async function getDocument(env: Bindings, sitter: string, id: string) {
  return env.DB.prepare(
    `${selection} WHERE d.id = ?1 AND d.sitter_id = ?2 AND d.upload_status = 'ready'`,
  )
    .bind(id, sitter)
    .first();
}

export const documentsApi = new Hono<AppEnv>();
documentsApi.get("/", async (c) => {
  const parsed = z
    .object({
      search: z.string().max(160).default(""),
      archived: z.enum(["true", "false"]).default("false"),
      clientId: z.string().optional(),
      petId: z.string().optional(),
      category: documentCategory.optional(),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    })
    .safeParse(c.req.query());
  if (!parsed.success)
    return c.json({ error: validationMessage(parsed.error) }, 400);
  const q = parsed.data;
  const rows = await c.env.DB.prepare(
    `${selection} WHERE d.sitter_id = ?1 AND d.upload_status = 'ready'
    AND ((?2 = 1 AND d.archived_at IS NOT NULL) OR (?2 = 0 AND d.archived_at IS NULL))
    AND (?3 IS NULL OR d.client_id = ?3) AND (?4 IS NULL OR d.pet_id = ?4) AND (?5 IS NULL OR d.category = ?5)
    AND (?6 = '' OR instr(lower(d.title || ' ' || d.file_name || ' ' || d.description), lower(?6)) > 0)
    ORDER BY d.created_at DESC, d.id DESC LIMIT 51 OFFSET ?7`,
  )
    .bind(
      c.get("sitterId"),
      q.archived === "true" ? 1 : 0,
      q.clientId ?? null,
      q.petId ?? null,
      q.category ?? null,
      q.search,
      q.offset,
    )
    .all();
  return c.json({
    documents: rows.results.slice(0, 50),
    hasMore: rows.results.length > 50,
  });
});

documentsApi.get("/:id", async (c) => {
  const document = await getDocument(
    c.env,
    c.get("sitterId"),
    c.req.param("id"),
  );
  return document
    ? c.json({ document })
    : c.json({ error: "Document not found" }, 404);
});

documentsApi.post("/", async (c) => {
  // Metadata stays in a header so the file body can be bounded before any R2 write.
  let metadata: unknown;
  try {
    metadata = JSON.parse(
      decodeURIComponent(c.req.header("x-document-metadata") ?? ""),
    );
  } catch {
    return c.json({ error: "Document details are required" }, 400);
  }
  const parsed = documentInput.safeParse(metadata);
  if (!parsed.success)
    return c.json({ error: validationMessage(parsed.error) }, 400);
  if (!(await ownership(c.env, c.get("sitterId"), parsed.data)))
    return c.json({ error: "Client or pet not found in your workspace" }, 404);
  const type =
    c.req.header("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  const declared = Number(c.req.header("x-file-size"));
  if (!types.includes(type))
    return c.json({ error: "Choose a PDF, PNG, JPEG, or WebP file" }, 415);
  if (
    !Number.isInteger(declared) ||
    declared < 1 ||
    declared > MAX_UPLOAD_BYTES
  )
    return c.json({ error: "Files must be between 1 byte and 10 MB" }, 413);
  const reader = c.req.raw.body?.getReader();
  if (!reader) return c.json({ error: "File is empty" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > declared || size > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        return c.json({ error: "File exceeds its declared size" }, 413);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== declared)
    return c.json({ error: "File size did not match the upload" }, 400);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (!matchesFileType(bytes, type))
    return c.json({ error: "The file contents do not match its type" }, 415);
  const id = crypto.randomUUID(),
    now = Date.now(),
    sitter = c.get("sitterId"),
    input = parsed.data;
  const name = sanitizeFileName(c.req.header("x-file-name") ?? "document");
  const key = `${sitter}/documents/${id}/${name}`;
  // Reserve metadata first; interrupted R2 writes can then be found and cleaned up by cron.
  await c.env.DB.prepare(
    `INSERT INTO upload_objects (id, sitter_id, object_key, file_name, content_type, size_bytes,
    title, description, category, client_id, pet_id, upload_status, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'uploading', ?12, ?12)`,
  )
    .bind(
      id,
      sitter,
      key,
      name,
      type,
      size,
      input.title,
      input.description,
      input.category,
      input.clientId,
      input.petId,
      now,
    )
    .run();
  try {
    await c.env.UPLOADS.put(key, bytes, {
      httpMetadata: { contentType: type },
    });
    await c.env.DB.prepare(
      "UPDATE upload_objects SET upload_status = 'ready' WHERE id = ?1 AND sitter_id = ?2",
    )
      .bind(id, sitter)
      .run();
  } catch {
    // Retain the reservation if cleanup also fails, so the scheduled job can retry it.
    try {
      await c.env.UPLOADS.delete(key);
      await c.env.DB.prepare(
        "DELETE FROM upload_objects WHERE id = ?1 AND upload_status = 'uploading'",
      )
        .bind(id)
        .run();
    } catch {
      /* cron retries */
    }
    return c.json({ error: "The file could not be saved. Please retry." }, 502);
  }
  return c.json({ document: await getDocument(c.env, sitter, id) }, 201);
});

documentsApi.put("/:id", async (c) => {
  const parsed = documentInput
    .extend({ version: z.number().int().positive() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: validationMessage(parsed.error) }, 400);
  if (!(await getDocument(c.env, c.get("sitterId"), c.req.param("id"))))
    return c.json({ error: "Document not found" }, 404);
  if (!(await ownership(c.env, c.get("sitterId"), parsed.data)))
    return c.json({ error: "Client or pet not found in your workspace" }, 404);
  const input = parsed.data;
  const result = await c.env.DB.prepare(
    `UPDATE upload_objects SET title = ?3, description = ?4, category = ?5,
    client_id = ?6, pet_id = ?7, updated_at = ?8, version = version + 1
    WHERE id = ?1 AND sitter_id = ?2 AND version = ?9 AND upload_status = 'ready' AND archived_at IS NULL`,
  )
    .bind(
      c.req.param("id"),
      c.get("sitterId"),
      input.title,
      input.description,
      input.category,
      input.clientId,
      input.petId,
      Date.now(),
      input.version,
    )
    .run();
  if (!result.meta.changes)
    return c.json(
      { error: "Document changed or was archived. Reload before editing." },
      409,
    );
  return c.json({
    document: await getDocument(c.env, c.get("sitterId"), c.req.param("id")),
  });
});

for (const action of ["archive", "restore"] as const) {
  documentsApi.post(`/:id/${action}`, async (c) => {
    const parsed = z
      .object({ version: z.number().int().positive() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: validationMessage(parsed.error) }, 400);
    if (!(await getDocument(c.env, c.get("sitterId"), c.req.param("id"))))
      return c.json({ error: "Document not found" }, 404);
    const now = Date.now();
    const result = await c.env.DB.prepare(
      `UPDATE upload_objects SET archived_at = ?3, updated_at = ?4, version = version + 1
      WHERE id = ?1 AND sitter_id = ?2 AND version = ?5 AND upload_status = 'ready' AND archived_at IS ${action === "archive" ? "NULL" : "NOT NULL"}`,
    )
      .bind(
        c.req.param("id"),
        c.get("sitterId"),
        action === "archive" ? now : null,
        now,
        parsed.data.version,
      )
      .run();
    if (!result.meta.changes)
      return c.json(
        { error: "Document changed. Reload before continuing." },
        409,
      );
    return c.json({
      document: await getDocument(c.env, c.get("sitterId"), c.req.param("id")),
    });
  });
}

documentsApi.get("/:id/download", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT object_key AS objectKey, file_name AS name, content_type AS type FROM upload_objects
    WHERE id = ?1 AND sitter_id = ?2 AND upload_status = 'ready'`,
  )
    .bind(c.req.param("id"), c.get("sitterId"))
    .first<{ objectKey: string; name: string; type: string }>();
  if (!row) return c.json({ error: "Document not found" }, 404);
  const object = await c.env.UPLOADS.get(row.objectKey);
  if (!object) return c.json({ error: "File not found" }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": row.type,
      "content-length": String(object.size),
      "content-disposition": `attachment; filename="${sanitizeFileName(row.name)}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
    },
  });
});

export async function cleanupIncompleteUploads(
  env: Bindings,
  now = Date.now(),
) {
  const rows = await env.DB.prepare(
    "SELECT id, object_key AS objectKey FROM upload_objects WHERE upload_status = 'uploading' AND created_at < ?1 LIMIT 5",
  )
    .bind(now - 3_600_000)
    .all<{ id: string; objectKey: string }>();
  for (const row of rows.results) {
    await env.UPLOADS.delete(row.objectKey);
    await env.DB.prepare(
      "DELETE FROM upload_objects WHERE id = ?1 AND upload_status = 'uploading'",
    )
      .bind(row.id)
      .run();
  }
}
