import { redirect } from "next/navigation";

/** The phone's full record moved to /imei/[id], open to anyone who can see its documents. */
export default async function Handset({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/imei/${(await params).id}`);
}
