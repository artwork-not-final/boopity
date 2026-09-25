import { Hono } from "hono";
import {
  normalizePhone,
  petInputSchema,
  petNoteSchema,
  validationMessage,
  type PetInput,
} from "./domain";
import type { AppEnv } from "./env";

type PetRow = {
  id: string;
  clientId: string;
  clientFirstName: string;
  clientLastName: string;
  name: string;
  species: string;
  breed: string | null;
  color: string | null;
  dateOfBirth: string | null;
  weight: number | null;
  spayedNeutered: number;
  microchipped: number;
  microchipId: string | null;
  vaccinationsCurrent: number;
  medicalConditions: string | null;
  medications: string | null;
  allergies: string | null;
  behaviorNotes: string | null;
  feedingInstructions: string | null;
  specialInstructions: string | null;
  vetName: string | null;
  vetPhone: string | null;
  vetClinic: string | null;
  isActive: number;
  createdAt: number;
  updatedAt: number;
};

const PET_SELECT = `
  SELECT p.id, p.client_id AS clientId,
         c.first_name AS clientFirstName, c.last_name AS clientLastName,
         p.name, p.species, p.breed, p.color, p.date_of_birth AS dateOfBirth, p.weight,
         p.spayed_neutered AS spayedNeutered, p.microchipped, p.microchip_id AS microchipId,
         p.vaccinations_current AS vaccinationsCurrent,
         p.medical_conditions AS medicalConditions, p.medications, p.allergies,
         p.behavior_notes AS behaviorNotes, p.feeding_instructions AS feedingInstructions,
         p.special_instructions AS specialInstructions, p.vet_name AS vetName,
         p.vet_phone AS vetPhone, p.vet_clinic AS vetClinic, p.is_active AS isActive,
         p.created_at AS createdAt, p.updated_at AS updatedAt
    FROM pets p JOIN clients c ON c.id = p.client_id`;

function presentPet(row: PetRow) {
  return {
    ...row,
    clientName: `${row.clientFirstName} ${row.clientLastName}`.trim(),
    spayedNeutered: Boolean(row.spayedNeutered),
    microchipped: Boolean(row.microchipped),
    vaccinationsCurrent: Boolean(row.vaccinationsCurrent),
    isActive: Boolean(row.isActive),
    // Photos are deferred; keep stored object keys private and unchanged.
    photoUrl: null,
  };
}

async function getPet(
  env: AppEnv["Bindings"],
  sitterId: string,
  petId: string,
) {
  const row = await env.DB.prepare(
    `${PET_SELECT} WHERE p.id = ?1 AND c.sitter_id = ?2 LIMIT 1`,
  )
    .bind(petId, sitterId)
    .first<PetRow>();
  return row ? presentPet(row) : null;
}

function petValues(input: PetInput) {
  return [
    input.name,
    input.species,
    input.breed,
    input.color,
    input.dateOfBirth,
    input.weight,
    input.spayedNeutered ? 1 : 0,
    input.microchipped ? 1 : 0,
    input.microchipped ? input.microchipId : null,
    input.vaccinationsCurrent ? 1 : 0,
    input.medicalConditions,
    input.medications,
    input.allergies,
    input.behaviorNotes,
    input.feedingInstructions,
    input.specialInstructions,
    input.vetName,
    normalizePhone(input.vetPhone),
    input.vetClinic,
  ];
}

export const petsApi = new Hono<AppEnv>();

petsApi.get("/:id", async (c) => {
  const sitterId = c.get("sitterId");
  const pet = await getPet(c.env, sitterId, c.req.param("id"));
  if (!pet) return c.json({ error: "Pet not found" }, 404);
  const note = await c.env.DB.prepare(
    "SELECT notes, updated_at AS updatedAt FROM sitter_pet_notes WHERE sitter_id = ?1 AND pet_id = ?2 LIMIT 1",
  )
    .bind(sitterId, c.req.param("id"))
    .first<{ notes: string; updatedAt: number }>();
  return c.json({ pet: { ...pet, sitterNotes: note?.notes ?? "" } });
});

petsApi.post("/clients/:clientId", async (c) => {
  const parsed = petInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: validationMessage(parsed.error) }, 400);
  const id = crypto.randomUUID();
  const now = Date.now();
  const result = await c.env.DB.prepare(
    `INSERT INTO pets
      (id, client_id, name, species, breed, color, date_of_birth, weight, spayed_neutered,
       microchipped, microchip_id, vaccinations_current, medical_conditions, medications,
       allergies, behavior_notes, feeding_instructions, special_instructions, vet_name,
       vet_phone, vet_clinic, is_active, created_at, updated_at)
     SELECT ?1, c.id, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
            ?14, ?15, ?16, ?17, ?18, ?19, ?20, 1, ?21, ?21
       FROM clients c
      WHERE c.id = ?22 AND c.sitter_id = ?23 AND c.status <> 'archived'`,
  )
    .bind(
      id,
      ...petValues(parsed.data),
      now,
      c.req.param("clientId"),
      c.get("sitterId"),
    )
    .run();
  if (result.meta.changes === 0)
    return c.json({ error: "Client not found or inactive" }, 404);
  return c.json({ pet: await getPet(c.env, c.get("sitterId"), id) }, 201);
});

petsApi.put("/:id", async (c) => {
  const parsed = petInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: validationMessage(parsed.error) }, 400);
  const result = await c.env.DB.prepare(
    `UPDATE pets
        SET name = ?1, species = ?2, breed = ?3, color = ?4, date_of_birth = ?5,
            weight = ?6, spayed_neutered = ?7, microchipped = ?8, microchip_id = ?9,
            vaccinations_current = ?10, medical_conditions = ?11, medications = ?12,
            allergies = ?13, behavior_notes = ?14, feeding_instructions = ?15,
            special_instructions = ?16, vet_name = ?17, vet_phone = ?18, vet_clinic = ?19,
            updated_at = ?20
      WHERE id = ?21 AND client_id IN
        (SELECT id FROM clients WHERE sitter_id = ?22 AND status <> 'archived')`,
  )
    .bind(
      ...petValues(parsed.data),
      Date.now(),
      c.req.param("id"),
      c.get("sitterId"),
    )
    .run();
  if (result.meta.changes === 0) return c.json({ error: "Pet not found" }, 404);
  return c.json({
    pet: await getPet(c.env, c.get("sitterId"), c.req.param("id")),
  });
});

petsApi.post("/:id/archive", async (c) => {
  const result = await c.env.DB.prepare(
    `UPDATE pets SET is_active = 0, updated_at = ?1
      WHERE id = ?2 AND is_active = 1 AND client_id IN
        (SELECT id FROM clients WHERE sitter_id = ?3)`,
  )
    .bind(Date.now(), c.req.param("id"), c.get("sitterId"))
    .run();
  if (result.meta.changes === 0)
    return c.json({ error: "Pet not found or already inactive" }, 404);
  return c.json({
    pet: await getPet(c.env, c.get("sitterId"), c.req.param("id")),
  });
});

petsApi.post("/:id/reactivate", async (c) => {
  const result = await c.env.DB.prepare(
    `UPDATE pets SET is_active = 1, updated_at = ?1
      WHERE id = ?2 AND is_active = 0 AND client_id IN
        (SELECT id FROM clients WHERE sitter_id = ?3 AND status <> 'archived')`,
  )
    .bind(Date.now(), c.req.param("id"), c.get("sitterId"))
    .run();
  if (result.meta.changes === 0)
    return c.json({ error: "Pet not found or its client is inactive" }, 404);
  return c.json({
    pet: await getPet(c.env, c.get("sitterId"), c.req.param("id")),
  });
});

petsApi.put("/:id/notes", async (c) => {
  const parsed = petNoteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: validationMessage(parsed.error) }, 400);
  const sitterId = c.get("sitterId");
  const petId = c.req.param("id");
  const ownedPet = await getPet(c.env, sitterId, petId);
  if (!ownedPet) return c.json({ error: "Pet not found" }, 404);
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO sitter_pet_notes (id, sitter_id, pet_id, notes, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT(sitter_id, pet_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at`,
  )
    .bind(crypto.randomUUID(), sitterId, petId, parsed.data.notes, now)
    .run();
  return c.json({ notes: parsed.data.notes, updatedAt: now });
});
