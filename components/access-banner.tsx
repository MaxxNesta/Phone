import { todayLocal } from "@/lib/format";

/**
 * The subscription, as the provider's console set it (0217): a quiet notice
 * two weeks before it ends, a warning once it has (grace), and a firm one when
 * the shop is read-only or suspended — when posting is refused
 * (lib/auth.ts requirePermission). Nothing at all while it is simply active.
 */
export function AccessBanner({ until, status }: { until: string | null; status: string }) {
  const today = todayLocal();
  const days = until ? Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null;
  const on = until ? new Date(`${until}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;

  let tone: "bad" | "warn" | "info" | null = null;
  let text = "";
  if (status === "suspended") {
    tone = "bad";
    text = "This shop is suspended. You can still look things up, but nothing can be posted. Contact your provider.";
  } else if (status === "read_only") {
    tone = "bad";
    // Past its date it ran out; before it, the provider set it so by hand.
    text = days !== null && days < 0
      ? `This shop is read-only: its subscription ended on ${on}. You can still look things up, but nothing can be posted until it is renewed.`
      : "This shop has been set to read-only. You can still look things up, but nothing can be posted. Contact your provider.";
  } else if (status === "grace") {
    tone = "warn";
    text = `Your subscription ${on ? `ended on ${on}` : "has ended"}. The shop keeps working for now; renew it to keep posting.`;
  } else if (days !== null && days < 0) {
    tone = "warn";
    text = `Your subscription ended on ${on}. Renew it to keep posting.`;
  } else if (days !== null && days <= 14) {
    tone = "info";
    text = days === 0 ? "Your subscription ends today." : `Your subscription ends on ${on}, in ${days} day${days === 1 ? "" : "s"}.`;
  }
  if (!tone) return null;
  return <div className={`access-banner ${tone}`} role={tone === "info" ? "status" : "alert"}>{text}</div>;
}
