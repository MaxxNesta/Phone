"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { toggleValue, clearFilters, type Facets, type Selection } from "@/lib/pos-facets";
import { useTranslations } from "next-intl";

const SHOWN = 6;

/**
 * The till's filter panel. What it offers depends on the category chosen
 * above it: the model list and each option group (Storage, Colour, SIM, Chip…)
 * come from the variants in that category, never from a fixed list.
 */
export function PosFilters({ facets, sel, total, onChange, onType }: {
  facets: Facets; sel: Selection; total: number;
  onChange: (s: Selection) => void; onType: (type: string) => void;
}) {
  const tr = useTranslations("pos");
  const typeTotal = facets.types.reduce((n, t) => n + t.count, 0);
  const none = facets.models.length === 0 && facets.groups.length === 0;

  return (
    <aside className="pf" aria-label={tr("filters")}>
      <div className="pf-head">
        <h2>{tr("filters")}{facets.active > 0 && <span className="pf-count">{facets.active}</span>}</h2>
        {facets.active > 0 && (
          <button type="button" className="pf-clear" onClick={() => onChange(clearFilters(sel))}>{tr("clearFilters")}</button>
        )}
      </div>

      <Block title={tr("category")}>
        <ul className="pf-list" role="radiogroup" aria-label={tr("category")}>
          <li>
            <button type="button" role="radio" aria-checked={!sel.type} className="pf-cat" onClick={() => onType("")}>
              <span>{tr("allProducts")}</span><span className="pf-n">{typeTotal}</span>
            </button>
          </li>
          {facets.types.map((t) => (
            <li key={t.type}>
              <button type="button" role="radio" aria-checked={sel.type === t.type} className="pf-cat" onClick={() => onType(t.type)}>
                <span>{t.type}</span><span className="pf-n">{t.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </Block>

      {facets.models.length > 0 && (
        <Checks title={tr("model")} attr="model" values={facets.models} sel={sel} onChange={onChange} searchable />
      )}
      {facets.groups.map((g) => (
        <Checks key={g.attr} title={g.attr} attr={g.attr} values={g.values} sel={sel} onChange={onChange} />
      ))}

      {none && (
        <p className="pf-empty">
          {total === 0 ? tr("filtersNoMatch") : tr("filtersNoMore")}
        </p>
      )}

      <Block title={tr("stock")}>
        <label className="pf-check">
          <input type="checkbox" checked={sel.inStockOnly} onChange={(e) => onChange({ ...sel, inStockOnly: e.target.checked })} />
          <span>{tr("inStockOnly")}</span>
        </label>
        <label className="pf-check">
          <input type="checkbox" checked={sel.lowOnly} onChange={(e) => onChange({ ...sel, lowOnly: e.target.checked })} />
          <span>{tr("lowStock")}</span>
        </label>
      </Block>
    </aside>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pf-block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Checks({ title, attr, values, sel, onChange, searchable }: {
  title: string; attr: string; values: Array<{ value: string; count: number; on: boolean }>;
  sel: Selection; onChange: (s: Selection) => void; searchable?: boolean;
}) {
  const tr = useTranslations("pos");
  const [all, setAll] = useState(false);
  const [find, setFind] = useState("");
  const list = values.filter((v) => !find || v.value.toLowerCase().includes(find.toLowerCase()));
  // Chosen values stay visible however the list is cut.
  const cut = all || find ? list : [...list.filter((v, n) => n < SHOWN || v.on)];
  return (
    <Block title={title}>
      {searchable && values.length > SHOWN && (
        <label className="pf-find">
          <Search size={14} aria-hidden="true" />
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={tr("searchIn", { what: title.toLowerCase() })}
            aria-label={tr("searchInLabel", { what: title.toLowerCase() })} />
        </label>
      )}
      <ul className="pf-list">
        {cut.map((v) => (
          <li key={v.value}>
            <label className="pf-check">
              <input type="checkbox" checked={v.on} onChange={() => onChange(toggleValue(sel, attr, v.value))} />
              <span>{v.value}</span><span className="pf-n">{v.count}</span>
            </label>
          </li>
        ))}
        {list.length === 0 && <li className="pf-none">{tr("noMatchShort")}</li>}
      </ul>
      {!find && list.length > cut.length && (
        <button type="button" className="pf-more" onClick={() => setAll(true)}>{tr("showMoreN", { n: list.length - cut.length })}</button>
      )}
      {!find && all && list.length > SHOWN && (
        <button type="button" className="pf-more" onClick={() => setAll(false)}>{tr("showFewer")}</button>
      )}
    </Block>
  );
}
