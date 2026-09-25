import type { SqlDatabase } from "./contracts";
import {
  brandingSchema,
  defaultBranding,
  type Branding,
} from "../src/shared/branding";

export async function readInstallation(db: SqlDatabase) {
  const row = await db
    .prepare(
      `SELECT setup_state AS state, business_name AS businessName,
    primary_color AS primaryColor, accent_color AS accentColor, logo_key AS logoKey, version FROM installation WHERE id = 1`,
    )
    .first<{
      state: string;
      businessName: string;
      primaryColor: string;
      accentColor: string;
      logoKey: string | null;
      version: number;
    }>();
  if (!row) throw new Error("Installation record missing");
  const branding = brandingSchema.safeParse({
    businessName: row.businessName,
    primaryColor: row.primaryColor,
    accentColor: row.accentColor,
    logoUrl: row.logoKey ? "/api/branding/logo" : null,
  });
  return {
    state: row.state,
    version: row.version,
    branding: branding.success ? branding.data : defaultBranding,
  };
}

/** Internal repository method; Phase 2 adds owner-authorized routes, not a public settings API. */
export async function saveBranding(
  db: SqlDatabase,
  input: Branding,
  version: number,
) {
  const brand = brandingSchema.parse(input);
  const result = await db
    .prepare(
      `UPDATE installation SET business_name = ?1, primary_color = ?2,
    accent_color = ?3, version = version + 1, updated_at = ?4 WHERE id = 1 AND version = ?5`,
    )
    .bind(
      brand.businessName,
      brand.primaryColor,
      brand.accentColor,
      Date.now(),
      version,
    )
    .run();
  if (!result.meta.changes)
    throw new Error("Appearance changed; reload before saving");
}
