import { EquityView } from "../view";

export const metadata = { title: "Share balance" };

export default async function Page({ searchParams }: { searchParams: Promise<{ holder?: string; from?: string; to?: string }> }) {
  return <EquityView tab="balance" p={await searchParams} />;
}
