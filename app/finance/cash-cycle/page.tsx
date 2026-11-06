import { redirect } from "next/navigation";

/** The cycle lives under Reports › Financial ratios now; old links land on its tab. */
export default async function CashCyclePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams({ tab: "ccc" });
  if (sp.from) q.set("from", sp.from);
  if (sp.to) q.set("to", sp.to);
  redirect(`/reports/financial-ratios?${q.toString()}`);
}
