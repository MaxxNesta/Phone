import { Hourglass } from "lucide-react";

/** Where a report lands when it has been asked for too often (lib/heavy.ts). */
export default async function Busy({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  return (
    <div className="empty" style={{ marginTop: "3rem" }}>
      <Hourglass size={22} aria-hidden="true" />
      <h2 style={{ margin: "0.6rem 0 0.3rem" }}>Please wait a moment</h2>
      <p>{m ?? "This report was asked for too often. Wait a moment and try again."}</p>
    </div>
  );
}
