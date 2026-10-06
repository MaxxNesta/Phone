/**
 * One page of a list that is already loaded. Totals, running balances and
 * filters are worked out from the whole list before this is called; paging
 * only decides which rows are drawn. The page number comes from the URL
 * (?page=), so a page can be linked, refreshed and gone back to.
 */
export const PAGE_SIZE = 25;

export function paginate<T>(rows: T[], pageParam: string | string[] | undefined, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const asked = Number(Array.isArray(pageParam) ? pageParam[0] : pageParam);
  const page = Math.min(pages, Math.max(1, Number.isFinite(asked) ? Math.floor(asked) : 1));
  const start = (page - 1) * size;
  return {
    rows: rows.slice(start, start + size),
    page, pages, total: rows.length,
    from: rows.length ? start + 1 : 0,
    to: Math.min(start + size, rows.length),
  };
}

export type Page = Omit<ReturnType<typeof paginate>, "rows">;
