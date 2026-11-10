import { EquityView } from "../view";

export const metadata = { title: "Balance" };

export default async function Page({ searchParams }: { searchParams: Promise<{ holder?: string; from?: string; to?: string }> }) {
  return <EquityView tab="balance" p={await searchParams} />;
}
