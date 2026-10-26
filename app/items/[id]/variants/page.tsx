import { notFound, redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getCompany } from "@/lib/queries";

/**
 * A product's variants are edited one at a time in the item editor, which
 * lists every sibling beside it. This old address opens that editor on the
 * first variant, so links and bookmarks to it keep working.
 */
export default async function VariantsOfProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await getCompany();
  if (!company) notFound();
  const [first] = await sql`select id from item where company_id = ${company.id} and parent_item_id = ${id}
                             order by code limit 1`;
  redirect(first ? `/items/${first.id}/edit` : `/items/${id}`);
}
