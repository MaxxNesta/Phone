import { EquityView } from "../view";

export const metadata = { title: "Share transfers" };

export default async function Page({ searchParams }: { searchParams: Promise<{ holder?: string; from?: string; to?: string }> }) {
  return <EquityView tab="transfers" p={await searchParams} />;
}
