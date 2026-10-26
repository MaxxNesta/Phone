import { redirect } from "next/navigation";

/** The Overview comes with Stage 4; until then the module opens on its register. */
export default function FixedAssets() {
  redirect("/fixed-assets/register");
}
