import { currentUser } from "@/lib/auth";
import { canPostFa } from "@/lib/fa-access";
import { sql } from "@/lib/db";
import { seenLocations } from "@/lib/branch-scope";
import { readyToPost, currentMonth } from "@/lib/fa-post";
import { fromUnits } from "@/lib/fa-engine";
import { FaReadyPopup } from "@/components/fa-ready-popup";

/** Fixed assets pages, with the "ready to post" popup for those who may post. */
export default async function FixedAssetsLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  let popup: React.ReactNode = null;
  if (user && canPostFa(user)) {
    const [s] = await sql`select posting_mode from fa_setting where company_id = ${user.companyId}`;
    if ((s?.posting_mode ?? "REVIEW") === "REVIEW") {
      const ready = await readyToPost(user.companyId, await seenLocations(), currentMonth());
      const first = ready[0]?.month;
      if (first) {
        const of = ready.filter((r) => r.month === first);
        popup = <FaReadyPopup month={first} branches={of.length}
          label={new Date(`${first}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
          amount={fromUnits(of.reduce((t, r) => t + r.amount, 0n))} />;
      }
    }
  }
  return <>{children}{popup}</>;
}
