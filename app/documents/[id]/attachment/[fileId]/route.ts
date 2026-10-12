import { getAttachment, getCompany, getDocument } from "@/lib/queries";
import { requireUser, can, permissionForDocument } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { getObject } from "@/lib/r2";

/**
 * A file from the private bucket, handed over by the app rather than by
 * Cloudflare.
 *
 * This route is the whole reason that bucket can stay private. A scanned
 * bill has a customer's name, a supplier's prices and sometimes a signature
 * on it, and none of that should be readable by anyone who guesses a URL —
 * so there is no public address for it, and every read comes through here.
 *
 * The gate is the document's own: whoever may open the document may read
 * what is attached to it, and nobody else — a scanned purchase bill is as
 * much a purchase as the bill.
 *
 * The document id is in the path and checked against the row, so a file
 * cannot be fetched by pointing at a document it does not belong to.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id, fileId } = await params;

  // Not lib/actions' companyId: that file is "use server", so anything
  // exported from it becomes callable from a browser.
  const user = await requireUser();
  const company = await getCompany();
  if (!company || company.id !== user.companyId) return new Response("Not found", { status: 404 });
  const doc = await getDocument(id);
  const seen = await seenLocations();
  if (!doc || !can(user, permissionForDocument(doc.doc_type as string))
      || (seen && !seen.includes(doc.location_id as string))) {
    return new Response("Not found", { status: 404 });
  }

  const row = await getAttachment(company.id, fileId);
  if (!row || row.document_id !== id) {
    return new Response("Not found", { status: 404 });
  }

  let file: { body: Buffer; contentType: string | undefined };
  try {
    file = await getObject("private", row.r2_key as string);
  } catch {
    // The row says there is a file and the bucket disagrees. Says so plainly
    // rather than returning an empty download: this is the drift that keeping
    // bytes outside the database makes possible, and it should be legible
    // when it happens rather than look like a broken browser.
    return new Response(
      "This file is recorded but its contents could not be read from storage.",
      { status: 502 },
    );
  }

  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": (row.mime as string) || file.contentType || "application/octet-stream",
      "Content-Length": String(file.body.byteLength),
      // Shown in the browser where it can be — a scan is usually something to
      // look at rather than to file away — under the name it was given.
      "Content-Disposition":
        `inline; filename="${String(row.filename).replace(/["\\]/g, "")}"`,
      // Private, so the shared caches in between must not keep a copy.
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
