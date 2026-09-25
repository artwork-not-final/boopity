import { parseInput } from "../core/http-input";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../core/env";
import {
  listQuery,
  pageInfo,
  PAGE_SIZE,
  searchPattern,
} from "../../src/shared/pagination";

type Ctx = Context<AppEnv>;
const clientSelect = `SELECT c.id,c.first_name AS firstName,c.last_name AS lastName,c.email,c.phone,c.status,
  (SELECT count(*) FROM pets p WHERE p.client_id=c.id) AS petCount,
  (SELECT count(*) FROM business_memberships m WHERE m.client_id=c.id AND m.role='client' AND m.revoked_at IS NULL) AS members,
  (SELECT max(expires_at) FROM client_invitations v WHERE v.client_id=c.id AND v.consumed_at IS NULL AND v.revoked_at IS NULL AND v.expires_at>?2) AS invitationExpiresAt`;
export async function clientList(c: Ctx) {
  const input = parseInput(
    listQuery.extend({
      status: z.enum(["all", "active", "lead", "archived"]).default("all"),
    }),
    c.req.query(),
  );
  const rows = await c.env.DB.prepare(
    `${clientSelect} FROM clients c WHERE c.sitter_id=?1
    AND (?3='all' OR c.status=?3)
    AND (?4='' OR lower(c.first_name||' '||c.last_name) LIKE ?5 ESCAPE '\\' OR lower(c.email) LIKE ?5 ESCAPE '\\' OR c.phone LIKE ?5 ESCAPE '\\')
    ORDER BY c.created_at DESC,c.id DESC LIMIT ?6 OFFSET ?7`,
  )
    .bind(
      c.get("sitterId"),
      Date.now(),
      input.status,
      input.search,
      searchPattern(input.search),
      PAGE_SIZE + 1,
      input.offset,
    )
    .all();
  return c.json({
    clients: rows.results.slice(0, PAGE_SIZE),
    pagination: pageInfo(input.offset, rows.results.length),
  });
}
export async function clientDetail(c: Ctx) {
  const client = await c.env.DB.prepare(
    `SELECT id,first_name AS firstName,last_name AS lastName,email,phone,address,status,notes,
    emergency_contact_name AS emergencyContactName,emergency_contact_phone AS emergencyContactPhone,updated_at AS updatedAt
    FROM clients WHERE id=?1 AND sitter_id=?2`,
  )
    .bind(c.req.param("id"), c.get("sitterId"))
    .first();
  if (!client) throw new HTTPException(404, { message: "Client not found." });
  // Pets have their own pageable resource, never a whole-household nested collection.
  return c.json({ client });
}
export async function petList(c: Ctx) {
  return c.json(await readPetPage(c));
}
export async function readPetPage(c: Ctx) {
  const owner = c.get("businessRole") === "owner";
  const input = parseInput(
    listQuery.extend({
      clientId: z.string().min(1).max(100).optional(),
      activeOnly: z.enum(["true", "false"]).default("false"),
    }),
    c.req.query(),
  );
  const clientId = owner ? input.clientId : c.get("clientId");
  if (!owner && input.clientId && input.clientId !== clientId)
    throw new HTTPException(403, { message: "Choose your own household." });
  if (
    clientId &&
    !(await c.env.DB.prepare(
      "SELECT 1 FROM clients WHERE id=?1 AND sitter_id=?2",
    )
      .bind(clientId, c.get("sitterId"))
      .first())
  ) {
    throw new HTTPException(404, { message: "Client not found." });
  }
  const rows = await c.env.DB.prepare(
    `SELECT p.id,p.client_id AS clientId,p.name,p.species,p.breed,p.is_active AS isActive
    FROM pets p JOIN clients c ON c.id=p.client_id WHERE c.sitter_id=?1 AND (?2 IS NULL OR p.client_id=?2)
    AND (?3=0 OR p.is_active=1) AND (?4='' OR lower(p.name) LIKE ?5 ESCAPE '\\')
    ORDER BY p.name,p.id LIMIT ?6 OFFSET ?7`,
  )
    .bind(
      c.get("sitterId"),
      clientId ?? null,
      input.activeOnly === "true",
      input.search,
      searchPattern(input.search),
      PAGE_SIZE + 1,
      input.offset,
    )
    .all();
  return {
    pets: rows.results.slice(0, PAGE_SIZE),
    pagination: pageInfo(input.offset, rows.results.length),
  };
}
export async function serviceList(c: Ctx) {
  const input = parseInput(
    listQuery.extend({
      activeOnly: z.enum(["true", "false"]).default("false"),
    }),
    c.req.query(),
  );
  const rows = await c.env.DB.prepare(
    `SELECT id,name,duration_minutes AS durationMinutes,price_cents AS priceCents,
    additional_pet_price_cents AS additionalPetPriceCents,portal_visible AS portalVisible,is_active AS isActive FROM services
    WHERE sitter_id=?1 AND (?2=1 OR portal_visible=1 AND is_active=1) AND (?3=0 OR is_active=1)
    AND (?4='' OR lower(name) LIKE ?5 ESCAPE '\\') ORDER BY name,id LIMIT ?6 OFFSET ?7`,
  )
    .bind(
      c.get("sitterId"),
      c.get("businessRole") === "owner",
      input.activeOnly === "true",
      input.search,
      searchPattern(input.search),
      PAGE_SIZE + 1,
      input.offset,
    )
    .all();
  return c.json({
    services: rows.results.slice(0, PAGE_SIZE),
    pagination: pageInfo(input.offset, rows.results.length),
  });
}

export async function serviceDetail(c: Ctx) {
  const service = await c.env.DB.prepare(
    `SELECT id,name,description,duration_minutes AS durationMinutes,price_cents AS priceCents,
    additional_pet_price_cents AS additionalPetPriceCents,portal_visible AS portalVisible,
    is_active AS isActive,created_at AS createdAt,updated_at AS updatedAt
    FROM services WHERE id=?1 AND sitter_id=?2`,
  )
    .bind(c.req.param("id"), c.get("sitterId"))
    .first<{
      priceCents: number;
      additionalPetPriceCents: number;
      isActive: number;
    }>();
  if (!service) throw new HTTPException(404, { message: "Service not found." });
  return c.json({
    service: {
      ...service,
      isActive: Boolean(service.isActive),
      price: service.priceCents / 100,
      additionalPetPrice: service.additionalPetPriceCents / 100,
    },
  });
}
