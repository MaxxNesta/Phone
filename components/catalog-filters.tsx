import type { CatalogFacets } from "@/lib/phone";

type Search = Record<string, string | undefined>;

/**
 * The model and option filters that were asked for and still make sense
 * for the chosen category. A model or option left over from another
 * category is dropped rather than filtering everything out.
 */
export function catalogSelection(sp: Search, facets: CatalogFacets) {
  const modelId = facets.models.some((m) => m.id === sp.model) ? sp.model : undefined;
  const optionIds = facets.attributes
    .map((a) => sp[`a_${a.id}`])
    .filter((v): v is string => Boolean(v) && facets.attributes.some((a) => a.options.some((o) => o.id === v)));
  const brandId = facets.brands.length > 1 && facets.brands.some((b) => b.id === sp.brand) ? sp.brand : undefined;
  return { modelId, optionIds, brandId };
}

/**
 * Category, then that category's model, then one select per attribute its
 * products use — iPhone: storage, colour, SIM; Mac: chip, memory. Brand
 * comes first, and only once the catalogue carries more than one.
 */
export function CatalogFilterFields({ groups, facets, sp, prefix }: {
  groups: { id: string; name: string }[];
  facets: CatalogFacets;
  sp: Search;
  /** Keeps ids unique when two filter bars share a page. */
  prefix: string;
}) {
  const category = groups.find((g) => g.id === sp.category);
  const { modelId, brandId } = catalogSelection(sp, facets);
  return (
    <>
      {facets.brands.length > 1 && (
        <div className="field">
          <label htmlFor={`${prefix}-brand`}>Brand</label>
          <select id={`${prefix}-brand`} name="brand" defaultValue={brandId ?? ""}>
            <option value="">All</option>
            {facets.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${prefix}-cat`}>Category</label>
        <select id={`${prefix}-cat`} name="category" defaultValue={sp.category ?? ""}>
          <option value="">All</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      {category && facets.models.length > 0 && (
        <div className="field">
          <label htmlFor={`${prefix}-model`}>{category.name} model</label>
          <select id={`${prefix}-model`} name="model" defaultValue={modelId ?? ""}>
            <option value="">All</option>
            {facets.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      )}
      {category && facets.attributes.map((a) => (
        <div className="field" key={a.id}>
          <label htmlFor={`${prefix}-${a.id}`}>{a.name}</label>
          <select id={`${prefix}-${a.id}`} name={`a_${a.id}`}
            defaultValue={a.options.some((o) => o.id === sp[`a_${a.id}`]) ? sp[`a_${a.id}`] : ""}>
            <option value="">All</option>
            {a.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      ))}
    </>
  );
}
