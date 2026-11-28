import { sql } from "./db";

/**
 * A customer's place, chosen from MIMU's list (0239, 2026-11-27), and the
 * region, city and township it fills in. The form sends place_code: a place,
 * "-" for "not sure yet", or nothing when the field was never shown.
 */
export type PlaceFields = { place_code: string | null; region: string | null; city: string | null; township: string | null };

/** null when the form did not ask (leave the customer's place as it is). */
export async function placeFields(raw: string | null | undefined): Promise<PlaceFields | null> {
  const code = (raw ?? "").trim();
  if (!code) return null;
  if (code === "-") return { place_code: null, region: null, city: null, township: null };
  const [p] = await sql`select code, kind, name, region, city from mm_place where code = ${code}`;
  if (!p) throw new Error("That place is not on the list. Choose it again from the township list.");
  return {
    place_code: p.code as string,
    region: p.region as string,
    city: (p.city as string | null) ?? null,
    // A city alone is its own township line, as "Mandalay" always was; a region alone has none.
    township: p.kind === "REGION" ? null : (p.name as string),
  };
}
