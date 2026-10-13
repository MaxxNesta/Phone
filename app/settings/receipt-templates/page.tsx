import { sql } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/auth-core";
import { seenLocations } from "@/lib/branch-scope";
import { sanitizeConfig, type Paper } from "@/lib/receipt-config";
import { mayEditReceiptTemplate } from "@/lib/receipt";
import { ReceiptTemplateEditor, type TemplateRow } from "@/components/receipt-template-editor";

export const metadata = { title: "Receipt Templates" };

export default async function ReceiptTemplates() {
  const user = await requirePermission("receipts.manage");
  const co = user.companyId;
  const isAdmin = can(user, "settings.manage");
  const locs = await seenLocations();

  const [templates, versions, audits, branches, [company], sales] = await Promise.all([
    sql`
      select t.id, t.name, t.paper, t.branch_id, b.name as branch_name, t.is_active, t.is_default,
             t.published_version, t.published_at, pu.name as published_by, t.draft_config,
             v.config as published_config, t.updated_at
        from receipt_template t
        left join location b on b.id = t.branch_id
        left join app_user pu on pu.id = t.published_by
        left join receipt_template_version v on v.template_id = t.id and v.version = t.published_version
       where t.company_id = ${co}
         -- Someone limited to a branch sees the company's templates and their own branch's.
         ${locs ? sql`and (t.branch_id is null or t.branch_id = any(${locs}))` : sql``}
       order by t.branch_id nulls first, t.is_default desc, t.name`,
    sql`
      select v.template_id, v.version, v.paper, v.published_at, u.name as published_by
        from receipt_template_version v join receipt_template t on t.id = v.template_id
        left join app_user u on u.id = v.published_by
       where t.company_id = ${co} order by v.version desc`,
    sql`
      select a.template_id, a.action, a.acted_at, u.name as acted_by, a.detail
        from receipt_template_audit a left join app_user u on u.id = a.acted_by
       where a.company_id = ${co} order by a.acted_at desc limit 300`,
    sql`
      select id, name, address, phone from location
       where company_id = ${co} and parent_id is null and is_active
         ${locs ? sql`and id = any(${locs})` : sql``}
       order by code`,
    sql`select name, address, phone, logo is not null as has_logo from company where id = ${co}`,
    // Recent counter sales to preview a template against, read-only.
    sql`
      select d.id, d.doc_no, d.posting_date::text as date, d.gross_total::float as total
        from document d
       where d.company_id = ${co} and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
         and d.reference like 'POS:%'
         ${locs ? sql`and d.location_id = any(${locs})` : sql``}
       order by d.posted_at desc nulls last limit 30`,
  ]) as any[];

  const rows: TemplateRow[] = templates.map((t: any) => {
    const paper = t.paper as Paper;
    const draft = sanitizeConfig(t.draft_config, paper);
    const published = t.published_config ? sanitizeConfig(t.published_config, paper) : null;
    return {
      id: t.id, name: t.name, paper, branchId: t.branch_id, branchName: t.branch_name,
      isActive: t.is_active, isDefault: t.is_default,
      publishedVersion: t.published_version, publishedAt: t.published_at ? String(t.published_at) : null,
      publishedBy: t.published_by,
      draft,
      // Unpublished changes: the draft is not what sales print.
      dirty: !published || JSON.stringify(published) !== JSON.stringify(draft),
      // The same rule the server applies to every change.
      canEdit: mayEditReceiptTemplate(user, t.branch_id),
      versions: versions.filter((v: any) => v.template_id === t.id).map((v: any) => ({
        version: v.version, paper: v.paper, publishedAt: String(v.published_at), publishedBy: v.published_by,
      })),
      audit: audits.filter((a: any) => a.template_id === t.id).slice(0, 15).map((a: any) => ({
        action: a.action, at: String(a.acted_at), by: a.acted_by, detail: a.detail,
      })),
    };
  });

  return (
    <ReceiptTemplateEditor
      templates={rows}
      isAdmin={isAdmin}
      myBranchId={user.branchId}
      branches={branches.map((b: any) => ({ id: b.id, name: b.name, address: b.address, phone: b.phone }))}
      company={{ name: company.name, address: company.address, phone: company.phone, hasLogo: company.has_logo }}
      sales={sales.map((s: any) => ({ id: s.id, docNo: s.doc_no, date: s.date, total: s.total }))}
    />
  );
}
