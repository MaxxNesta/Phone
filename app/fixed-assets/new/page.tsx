import { requireFaPoster } from "@/lib/fa-access";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { NewAssetForm } from "@/components/new-asset-form";

export const metadata = { title: "Add asset" };

export default async function NewAsset() {
  const user = await requireFaPoster();
  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Fixed Assets" }, { label: "Asset Register", href: "/fixed-assets/register" }, { label: "Add asset" }]} />
      <NewAssetForm co={user.companyId} />
    </div>
  );
}
