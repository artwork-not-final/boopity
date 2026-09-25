import { Hono } from "hono";
import type { AppEnv } from "../core/env";
import { serviceInputSchema, validationMessage } from "./domain";

type ServiceRow = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number | null;
  priceCents: number;
  additionalPetPriceCents: number;
  isActive: number;
  createdAt: number;
  updatedAt: number;
};

function presentService(row: ServiceRow | null) {
  if (!row) return null;
  return {
    ...row,
    price: row.priceCents / 100,
    additionalPetPrice: row.additionalPetPriceCents / 100,
    isActive: Boolean(row.isActive),
  };
}

async function getService(
  env: AppEnv["Bindings"],
  sitterId: string,
  id: string,
) {
  return env.DB.prepare(
    `SELECT id, name, description, duration_minutes AS durationMinutes,
            price_cents AS priceCents, additional_pet_price_cents AS additionalPetPriceCents,
            is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
       FROM services WHERE id = ?1 AND sitter_id = ?2 LIMIT 1`,
  )
    .bind(id, sitterId)
    .first<ServiceRow>();
}

export const servicesApi = new Hono<AppEnv>();

servicesApi.post("/", async (c) => {
  const parsed = serviceInputSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success)
    return c.json({ error: validationMessage(parsed.error) }, 400);
  const id = crypto.randomUUID();
  const now = Date.now();
  const input = parsed.data;
  await c.env.DB.prepare(
    `INSERT INTO services
       (id, sitter_id, name, description, duration_minutes, price_cents,
        additional_pet_price_cents, is_active, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)`,
  )
    .bind(
      id,
      c.get("sitterId"),
      input.name,
      input.description,
      input.durationMinutes,
      Math.round(input.price * 100),
      Math.round(input.additionalPetPrice * 100),
      now,
    )
    .run();
  return c.json(
    { service: presentService(await getService(c.env, c.get("sitterId"), id)) },
    201,
  );
});

servicesApi.put("/:id", async (c) => {
  const parsed = serviceInputSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success)
    return c.json({ error: validationMessage(parsed.error) }, 400);
  const input = parsed.data;
  const result = await c.env.DB.prepare(
    `UPDATE services
        SET name = ?1, description = ?2, duration_minutes = ?3, price_cents = ?4,
            additional_pet_price_cents = ?5, updated_at = ?6
      WHERE id = ?7 AND sitter_id = ?8`,
  )
    .bind(
      input.name,
      input.description,
      input.durationMinutes,
      Math.round(input.price * 100),
      Math.round(input.additionalPetPrice * 100),
      Date.now(),
      c.req.param("id"),
      c.get("sitterId"),
    )
    .run();
  if (result.meta.changes === 0)
    return c.json({ error: "Service template not found" }, 404);
  return c.json({
    service: presentService(
      await getService(c.env, c.get("sitterId"), c.req.param("id")),
    ),
  });
});

servicesApi.post("/:id/archive", async (c) => {
  const result = await c.env.DB.prepare(
    "UPDATE services SET is_active = 0, updated_at = ?1 WHERE id = ?2 AND sitter_id = ?3 AND is_active = 1",
  )
    .bind(Date.now(), c.req.param("id"), c.get("sitterId"))
    .run();
  if (result.meta.changes === 0)
    return c.json({ error: "Active service template not found" }, 404);
  return c.json({
    service: presentService(
      await getService(c.env, c.get("sitterId"), c.req.param("id")),
    ),
  });
});

servicesApi.post("/:id/reactivate", async (c) => {
  const result = await c.env.DB.prepare(
    "UPDATE services SET is_active = 1, updated_at = ?1 WHERE id = ?2 AND sitter_id = ?3 AND is_active = 0",
  )
    .bind(Date.now(), c.req.param("id"), c.get("sitterId"))
    .run();
  if (result.meta.changes === 0)
    return c.json({ error: "Inactive service template not found" }, 404);
  return c.json({
    service: presentService(
      await getService(c.env, c.get("sitterId"), c.req.param("id")),
    ),
  });
});
