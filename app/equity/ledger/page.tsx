import { EquityView } from "../view";

export const metadata = { title: "Ledger" };

export default async function Page({ searchParams }: { searchParams: Promise<{ holder?: string; from?: string; to?: string }> }) {
  return <EquityView tab="ledger" p={await searchParams} />;
}
