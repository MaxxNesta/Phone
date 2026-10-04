import { sql } from "./db";

export type Node = {
  id: string;
  code: string;
  segment: string;
  name: string;
  name_my: string | null;
  parent_id: string | null;
  is_active: boolean;
};

export type Crumb = { id: string; name: string };

/** Every category for a company, cheap enough to fetch whole and walk in memory. */
export async function allCategories(companyId: string): Promise<Node[]> {
  return (await sql`
    select id, code, segment, name, name_my, parent_id, is_active
      from item_group
     where company_id = ${companyId}
     order by code`) as unknown as Node[];
}

/** Root-first ancestry of a category, for breadcrumbs. */
export function trail(nodes: Node[], id: string | null): Crumb[] {
  const out: Crumb[] = [];
  let cur = id ? nodes.find((n) => n.id === id) : undefined;
  while (cur) {
    out.unshift({ id: cur.id, name: cur.name });
    const pid: string | null = cur.parent_id;
    cur = pid ? nodes.find((n) => n.id === pid) : undefined;
  }
  return out;
}

export function childrenOf(nodes: Node[], parentId: string | null): Node[] {
  return nodes.filter((n) => n.parent_id === parentId);
}

/** How deep a category sits. Top level is 0. */
export function depthOf(nodes: Node[], id: string | null): number {
  return id ? trail(nodes, id).length - 1 : -1;
}

/** Ids of a category and everything beneath it. */
export function branchIds(nodes: Node[], id: string): string[] {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parent_id && out.has(n.parent_id) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return [...out];
}

/** Depth 0 is a top-level category; depth 1 is a sub category. Nothing nests below that. */
export const CATEGORY_LEVELS = ["Category", "Sub category"];
export const MAX_CATEGORY_DEPTH = CATEGORY_LEVELS.length - 1;

/** What to call the level below the one being viewed. */
export function levelLabel(depth: number): string {
  return CATEGORY_LEVELS[depth] ?? `Level ${depth + 1}`;
}

/** "Category" -> "Categories", "Level 3" -> "Level 3 categories". */
export function levelLabelPlural(depth: number): string {
  const one = levelLabel(depth);
  if (one.endsWith("y")) return `${one.slice(0, -1)}ies`;
  if (one.startsWith("Level ")) return `${one} categories`;
  return `${one}s`;
}

/** Every sub category (depth 1) across the whole tree, parent-code first. */
export function subcategories(nodes: Node[]): Node[] {
  return nodes
    .filter((n) => n.parent_id !== null)
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Direct child count and total item count for each category in one round trip. */
export async function levelCounts(companyId: string) {
  const [children, items] = await Promise.all([
    sql`select parent_id, count(*)::int as n from item_group
         where company_id = ${companyId} and parent_id is not null
         group by parent_id`,
    sql`select item_group_id, count(*)::int as n from item
         where company_id = ${companyId} group by item_group_id`,
  ]);

  return {
    childrenOf: (id: string) =>
      (children as any[]).find((c) => c.parent_id === id)?.n ?? 0,
    itemsIn: (id: string) =>
      (items as any[]).find((c) => c.item_group_id === id)?.n ?? 0,
  };
}
