import { EquityView } from "../view";

export const metadata = { title: "Shareholders" };

export default async function Page({ searchParams }: { searchParams: Promise<{ holder?: string; from?: string; to?: string }> }) {
  return <EquityView tab="shareholders" p={await searchParams} />;
}
