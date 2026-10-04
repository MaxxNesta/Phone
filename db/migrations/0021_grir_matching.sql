-- 0021_grir_matching.sql
-- v_grir_balance grouped by journal_entry.source_id — the posting document's
-- own id, always. That's correct for an unmatched receipt or invoice, but a
-- purchase invoice matched to an existing goods receipt (or a goods receipt
-- matched to an existing invoice) posts its own GR/IR line under its OWN
-- document, never the document it matched against. Two documents that
-- genuinely offset each other in the ledger were landing in two separate
-- rows here, neither of which ever nets to zero — so a "matched" pair could
-- never actually disappear from the GR/IR outstanding report, no matter how
-- correctly it was matched.
--
-- Fix: when a document's source_document_id points at another document that
-- itself posts to GR/IR clearing (a goods receipt or purchase invoice —
-- never a purchase order, which never touches this account), group under
-- that earlier document's id instead of its own. The anchor document (the
-- one nothing points back from) keeps grouping under itself, unchanged.

create or replace view v_grir_balance as
select
    jl.company_id,
    jl.partner_id,
    case
      when src.doc_type in ('GOODS_RECEIPT', 'PURCHASE_INVOICE') then d.source_document_id
      else d.id
    end as document_id,
    sum(jl.base_amount) as balance,
    min(je.entry_date)  as oldest_entry_date,
    current_date - min(je.entry_date) as days_open
  from journal_line   jl
  join journal_entry  je on je.id = jl.journal_entry_id
  join system_account sa on sa.account_id = jl.account_id
                         and sa.company_id = jl.company_id
                         and sa.role       = 'GRIR_CLEARING'
  join document        d on d.id = je.source_id
  left join document  src on src.id = d.source_document_id
 group by jl.company_id, jl.partner_id,
          case
            when src.doc_type in ('GOODS_RECEIPT', 'PURCHASE_INVOICE') then d.source_document_id
            else d.id
          end
having sum(jl.base_amount) <> 0;

comment on view v_grir_balance is
    'Outstanding GR/IR clearing balance per purchase, not per document -- a '
    'matched receipt and invoice pair are grouped together (under whichever '
    'one the other points back to) so a fully matched pair nets to zero and '
    'drops out, same as an unmatched one still sitting there does not.';
