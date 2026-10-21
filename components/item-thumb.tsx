import { useTranslations } from "next-intl";

/**
 * The item's picture at the size a list can afford.
 *
 * 25px square, always — a catalogue whose rows are 25px, 25px, 60px, 25px is
 * a catalogue that jitters as it loads. The picture is fitted to that box by covering it, never
 * by being squashed into it: a portrait shot of a phone loses a little top
 * and bottom rather than becoming a fat phone, which at this size is the
 * difference between recognising it and not.
 *
 * Most items have no photo and are not missing anything, so an item without
 * one draws nothing at all: an empty placeholder box took a column's worth
 * of space on every row and said nothing (owner's call, 2026-10-22).
 */
export function ItemThumb({ src, name }: { src: string | null; name: string }) {
  const t = useTranslations("items");
  if (!src) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- served straight
    // from the database by a route of our own; next/image would proxy and
    // re-encode something already encoded to exactly this purpose.
    <img className="item-thumb" src={src} alt={t("photoOf", { name })} width={25} height={25} loading="lazy" />
  );
}
