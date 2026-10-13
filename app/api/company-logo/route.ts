import { sql } from "@/lib/db";
import { currentUser } from "@/lib/auth";

/**
 * The signed-in company's logo, for its receipts. Only ever PNG or JPEG
 * (checked by its bytes when uploaded), served with that type and told not to
 * be sniffed as anything else.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  const [c] = await sql`select logo, logo_mime from company where id = ${user.companyId}`;
  if (!c?.logo || !c.logo_mime) return new Response("No logo", { status: 404 });
  return new Response(new Uint8Array(c.logo as Buffer), {
    headers: {
      "Content-Type": c.logo_mime as string,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
