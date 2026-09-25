import { Hono } from "hono";
import type { AppEnv } from "../core/env";
import { clientInputSchema, normalizePhone, validationMessage } from "./domain";

type ClientRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  notes: string;
  status: "lead" | "active" | "archived";
  createdAt: number;
  updatedAt: number;
};

async function getClient(
  env: AppEnv["Bindings"],
  sitterId: string,
  clientId: string,
) {
  return env.DB.prepare(
    `SELECT id, first_name AS firstName, last_name AS lastName, email, phone, address,
            emergency_contact_name AS emergencyContactName,
            emergency_contact_phone AS emergencyContactPhone, notes, status,
            created_at AS createdAt, updated_at AS updatedAt
       FROM clients WHERE id = ?1 AND sitter_id = ?2 LIMIT 1`,
  )
    .bind(clientId, sitterId)
    .first<ClientRow>();
}

// Owner mutations only. Paginated reads are registered in server/business/routes.ts.
export const clientsApi = new Hono<AppEnv>();

clientsApi.post("/", async (c) => {
  const parsed = clientInputSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success)
    return c.json({ error: validationMessage(parsed.error) }, 400);

  const sitterId = c.get("sitterId");
  const input = parsed.data;
  const id = crypto.randomUUID();
  const now = Date.now();
  const result = await c.env.DB.prepare(
    `INSERT INTO clients
      (id, sitter_id, first_name, last_name, email, phone, address,
       emergency_contact_name, emergency_contact_phone, notes, status, created_at, updated_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12
       FROM sitter_profiles sp
      WHERE sp.id = ?2`,
  )
    .bind(
      id,
      sitterId,
      input.firstName,
      input.lastName,
      input.email,
      normalizePhone(input.phone),
      input.address,
      input.emergencyContactName,
      normalizePhone(input.emergencyContactPhone),
      input.notes,
      input.status,
      now,
    )
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: "Business not found. Refresh the page." }, 404);
  }

  return c.json({ client: await getClient(c.env, sitterId, id) }, 201);
});

clientsApi.put("/:id", async (c) => {
  const parsed = clientInputSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success)
    return c.json({ error: validationMessage(parsed.error) }, 400);
  const input = parsed.data;
  const result = await c.env.DB.prepare(
    `UPDATE clients
        SET first_name = ?1, last_name = ?2, email = ?3, phone = ?4, address = ?5,
            emergency_contact_name = ?6, emergency_contact_phone = ?7, notes = ?8,
            status = CASE WHEN status = 'archived' THEN status ELSE ?9 END, updated_at = ?10
      WHERE id = ?11 AND sitter_id = ?12`,
  )
    .bind(
      input.firstName,
      input.lastName,
      input.email,
      normalizePhone(input.phone),
      input.address,
      input.emergencyContactName,
      normalizePhone(input.emergencyContactPhone),
      input.notes,
      input.status,
      Date.now(),
      c.req.param("id"),
      c.get("sitterId"),
    )
    .run();
  if (result.meta.changes === 0)
    return c.json({ error: "Client not found" }, 404);
  return c.json({
    client: await getClient(c.env, c.get("sitterId"), c.req.param("id")),
  });
});

clientsApi.post("/:id/archive", async (c) => {
  const result = await c.env.DB.prepare(
    `UPDATE clients SET status = 'archived', updated_at = ?1
      WHERE id = ?2 AND sitter_id = ?3 AND status <> 'archived'`,
  )
    .bind(Date.now(), c.req.param("id"), c.get("sitterId"))
    .run();
  if (result.meta.changes === 0)
    return c.json({ error: "Client not found or already inactive" }, 404);
  return c.json({
    client: await getClient(c.env, c.get("sitterId"), c.req.param("id")),
  });
});

clientsApi.post("/:id/reactivate", async (c) => {
  const sitterId = c.get("sitterId");
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(
    `UPDATE clients
        SET status = 'active', updated_at = ?1
      WHERE id = ?2 AND sitter_id = ?3 AND status = 'archived'`,
  )
    .bind(Date.now(), id, sitterId)
    .run();
  if (result.meta.changes === 0) {
    const client = await getClient(c.env, sitterId, id);
    if (!client) return c.json({ error: "Inactive client not found" }, 404);
    return c.json(
      { error: "This client changed or is already active. Refresh the page." },
      409,
    );
  }
  return c.json({ client: await getClient(c.env, sitterId, id) });
});
