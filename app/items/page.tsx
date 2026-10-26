import { redirect } from "next/navigation";

/** The catalogue list is All products now; this address keeps old links working. */
export default function Items() {
  redirect("/products");
}
