-- An asset is used where it is not bought
--
-- Head Office buys an air conditioner for the Mandalay branch. The company
-- owns it; Mandalay uses it (branch_id, the assigned branch); its
-- depreciation posts to Mandalay too, unless the company's policy says
-- otherwise for that asset. posting_branch_id is that exception: null means
-- the assigned branch. Who paid for it never decides where it depreciates.
--
-- Historical journals with no branch stay company-level: nothing here
-- spreads them over branches.

alter table fixed_asset add column if not exists posting_branch_id uuid references location(id);
alter table fixed_asset drop constraint if exists fixed_asset_posting_branch_differs;
alter table fixed_asset add constraint fixed_asset_posting_branch_differs
    check (posting_branch_id is null or posting_branch_id <> branch_id);
create index if not exists fixed_asset_posting_branch on fixed_asset (posting_branch_id) where posting_branch_id is not null;

comment on column fixed_asset.branch_id is 'The assigned branch: where the asset is used.';
comment on column fixed_asset.posting_branch_id is 'Where depreciation posts when it is not the assigned branch; null = the assigned branch.';
