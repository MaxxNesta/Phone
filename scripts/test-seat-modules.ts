// A module seat sees only its module (lib/plans.ts hasModule).
//   npx tsx scripts/test-seat-modules.ts
import { hasModule } from "../lib/plans";
const c = (seat: string) => ({ modules: ["sales", "purchases", "inventory", "accounting", "landed_cost", "equity", "fixed_assets", "hr"], plan: "BUSINESS" as const, seat });
const ok = (b: boolean, m: string) => { if (!b) { console.error("FAIL", m); process.exit(1); } };
ok(hasModule(c("sales"), "sales") && !hasModule(c("sales"), "inventory") && !hasModule(c("sales"), "purchases"), "sales seat");
ok(hasModule(c("inventory"), "inventory") && !hasModule(c("inventory"), "sales") && !hasModule(c("inventory"), "purchases"), "inventory seat");
ok(hasModule(c("accounting"), "accounting") && hasModule(c("accounting"), "equity") && !hasModule(c("accounting"), "sales") && !hasModule(c("accounting"), "hr"), "accounting seat");
ok(hasModule(c("purchases"), "landed_cost") && !hasModule(c("sales"), "landed_cost"), "landed cost");
ok(hasModule(c("package"), "inventory") && hasModule(c("package"), "hr"), "package seat");
console.log("PASS");
