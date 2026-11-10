import Link from "next/link";
import { getCompany } from "@/lib/queries";
import { costSection } from "@/lib/courier-payables";

type Tab = "list" | "couriers" | "ledger" | "advances";

/**
 * The pages about who owes what, one set of tabs on each of them: the same
 * tabs in the same order wherever you stand, so moving between the list,
 * the ledger and the advances never loses one.
 */
export async function PartnerTabs({ side, active, section }: {
  side: "SUPPLIER" | "CUSTOMER"; active: Tab;
  /** Payables only: what courier and import bills are called here. Read when not given. */
  section?: string;
}) {
  const pay = side === "SUPPLIER";
  const tabs: [Tab, string, string][] = pay
    ? [
        ["list", "/payables", "Suppliers"],
        ["couriers", "/payables?view=couriers", section ?? await costSectionOf()],
        ["ledger", "/payables/ledger", "Supplier ledger"],
        ["advances", "/payables/advances", "Advances"],
      ]
    : [
        ["list", "/receivables", "Customers"],
        ["ledger", "/receivables/ledger", "Customer ledger"],
        ["advances", "/receivables/advances", "Advances"],
      ];
  return (
    <nav className="vtabs pay-tabs" aria-label={pay ? "Payables" : "Receivables"}>
      {tabs.map(([key, href, label]) => (
        <Link key={key} href={href} aria-current={key === active ? "page" : undefined} className={key === active ? "on" : undefined}>{label}</Link>
      ))}
    </nav>
  );
}

async function costSectionOf() {
  const co = await getCompany();
  return co ? costSection(co.id) : "Carriage inward";
}
