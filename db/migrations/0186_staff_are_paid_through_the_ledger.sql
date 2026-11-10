-- Staff are paid through the ledger
--
-- HR & Payroll, first version: employees, their salary settings, salary
-- advances, a monthly payroll run with one payslip per employee, and salary
-- payments. A subledger in the fixed-assets way: its own tables, and every
-- money figure reaches the books only through an ordinary voucher posted by
-- lib/posting.ts. Rows that point at a voucher count only while that voucher
-- is POSTED, so voiding it through the usual void screen is the correction.
--
-- An employee is not a login. user_id links one, optionally; it never
-- creates one and never takes a seat.

create table if not exists hr_setting (
  company_id              uuid primary key references company(id) on delete cascade,
  pay_frequency           text not null default 'MONTHLY' check (pay_frequency = 'MONTHLY'),
  advance_account_id      uuid references account(id),
  payable_account_id      uuid references account(id),
  basic_account_id        uuid references account(id),
  allowance_account_id    uuid references account(id),
  overtime_account_id     uuid references account(id),
  commission_account_id   uuid references account(id),
  bonus_account_id        uuid references account(id),
  other_earning_account_id uuid references account(id),
  tax_account_id          uuid references account(id),
  statutory_account_id    uuid references account(id),
  other_deduction_account_id uuid references account(id),
  updated_at              timestamptz not null default now()
);

create table if not exists employee (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references company(id) on delete cascade,
  code            text not null,
  full_name       text not null check (length(trim(full_name)) > 0),
  phone           text,
  branch_id       uuid not null references location(id),
  department      text,
  position        text,
  joined_on       date,
  status          text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  pay_method      text not null default 'CASH' check (pay_method in ('CASH', 'BANK')),
  bank_name       text,
  bank_account_name text,
  bank_account_no text,
  notes           text,
  user_id         uuid references app_user(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, code)
);
create unique index if not exists employee_one_login on employee (user_id) where user_id is not null;
create index if not exists employee_branch on employee (company_id, branch_id);

-- Salary settings, one row per change. A new row from a date never alters
-- an older one; a posted payslip carries its own copy of what it used.
create table if not exists hr_salary (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references company(id) on delete cascade,
  employee_id     uuid not null references employee(id),
  effective_from  date not null,
  basic           numeric(18,4) not null check (basic >= 0),
  notes           text,
  created_by      uuid references app_user(id),
  created_at      timestamptz not null default now(),
  unique (employee_id, effective_from)
);
create table if not exists hr_salary_allowance (
  id              uuid primary key default gen_random_uuid(),
  salary_id       uuid not null references hr_salary(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  amount          numeric(18,4) not null check (amount > 0)
);
create index if not exists hr_salary_allowance_salary on hr_salary_allowance (salary_id);

create table if not exists hr_advance (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references company(id) on delete cascade,
  advance_no      text not null,
  employee_id     uuid not null references employee(id),
  advance_date    date not null,
  amount          numeric(18,4) not null check (amount > 0),
  document_id     uuid not null unique references document(id),
  recovery_method text not null check (recovery_method in ('FULL', 'FIXED', 'MANUAL')),
  recovery_amount numeric(18,4) check (recovery_amount > 0),
  first_period    date not null check (extract(day from first_period) = 1),
  reference       text,
  note            text,
  created_by      uuid references app_user(id),
  created_at      timestamptz not null default now(),
  unique (company_id, advance_no),
  check ((recovery_method = 'FIXED') = (recovery_amount is not null))
);
create index if not exists hr_advance_employee on hr_advance (employee_id);

-- Paid back in cash or by bank, outside payroll.
create table if not exists hr_advance_repayment (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references company(id) on delete cascade,
  advance_id      uuid not null references hr_advance(id),
  document_id     uuid not null unique references document(id),
  amount          numeric(18,4) not null check (amount > 0),
  created_at      timestamptz not null default now()
);
create index if not exists hr_advance_repayment_advance on hr_advance_repayment (advance_id);

-- REGULAR is the month's payroll: an employee is in one live regular run per
-- period. SUPPLEMENTARY (a bonus run, a correction) is not limited.
create table if not exists hr_payroll_run (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references company(id) on delete cascade,
  run_no          text not null,
  kind            text not null default 'REGULAR' check (kind in ('REGULAR', 'SUPPLEMENTARY')),
  period_start    date not null,
  period_end      date not null,
  posting_date    date not null,
  branch_id       uuid not null references location(id),
  status          text not null default 'DRAFT' check (status in ('DRAFT', 'POSTED')),
  document_id     uuid unique references document(id),
  notes           text,
  created_by      uuid references app_user(id),
  created_at      timestamptz not null default now(),
  posted_by       uuid references app_user(id),
  posted_at       timestamptz,
  unique (company_id, run_no),
  check (period_end >= period_start),
  check ((status = 'POSTED') = (document_id is not null))
);
create index if not exists hr_payroll_run_period on hr_payroll_run (company_id, period_start, period_end);

-- One per employee per run, with what the payslip prints, copied when the
-- run was prepared so a later change to the employee does not rewrite it.
create table if not exists hr_payslip (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references company(id) on delete cascade,
  run_id          uuid not null references hr_payroll_run(id) on delete cascade,
  employee_id     uuid not null references employee(id),
  employee_code   text not null,
  employee_name   text not null,
  department      text,
  position        text,
  salary_id       uuid references hr_salary(id),
  unique (run_id, employee_id)
);
create index if not exists hr_payslip_employee on hr_payslip (employee_id);

create table if not exists hr_payslip_line (
  id              uuid primary key default gen_random_uuid(),
  payslip_id      uuid not null references hr_payslip(id) on delete cascade,
  seq             int not null default 0,
  kind            text not null check (kind in ('BASIC', 'ALLOWANCE', 'OVERTIME', 'COMMISSION', 'BONUS', 'OTHER_EARNING',
                                                'ADVANCE', 'TAX', 'STATUTORY', 'OTHER_DEDUCTION')),
  label           text not null,
  amount          numeric(18,4) not null check (amount > 0),
  advance_id      uuid references hr_advance(id),
  check ((kind = 'ADVANCE') = (advance_id is not null))
);
create index if not exists hr_payslip_line_slip on hr_payslip_line (payslip_id);
create index if not exists hr_payslip_line_advance on hr_payslip_line (advance_id) where advance_id is not null;

create table if not exists hr_salary_payment (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references company(id) on delete cascade,
  payslip_id      uuid not null references hr_payslip(id),
  document_id     uuid not null references document(id),
  amount          numeric(18,4) not null check (amount > 0),
  created_at      timestamptz not null default now(),
  unique (document_id, payslip_id)
);
create index if not exists hr_salary_payment_slip on hr_salary_payment (payslip_id);

-- What an advance has had back: payroll recoveries in posted runs and
-- repayments on posted vouchers. Nothing counts once its voucher is voided,
-- and an advance whose own voucher is voided is dead.
create or replace view v_hr_advance as
select a.*, d.doc_no, d.status as doc_status, e.code as employee_code, e.full_name as employee_name, e.branch_id,
       coalesce(rc.amount, 0) as recovered, coalesce(rp.amount, 0) as repaid,
       a.amount - coalesce(rc.amount, 0) - coalesce(rp.amount, 0) as outstanding
  from hr_advance a
  join document d on d.id = a.document_id
  join employee e on e.id = a.employee_id
  left join lateral (
    select sum(l.amount) as amount from hr_payslip_line l
      join hr_payslip s on s.id = l.payslip_id
      join hr_payroll_run r on r.id = s.run_id
      join document rd on rd.id = r.document_id and rd.status = 'POSTED'
     where l.advance_id = a.id) rc on true
  left join lateral (
    select sum(x.amount) as amount from hr_advance_repayment x
      join document xd on xd.id = x.document_id and xd.status = 'POSTED'
     where x.advance_id = a.id) rp on true;

-- A payslip's totals and what has been paid against it, read from its lines.
create or replace view v_hr_payslip as
select s.*, r.run_no, r.kind as run_kind, r.branch_id, r.period_start, r.period_end, r.posting_date,
       r.status as run_status, r.document_id as run_document_id, rd.status as journal_status,
       coalesce(t.gross, 0) as gross, coalesce(t.deductions, 0) as deductions,
       coalesce(t.gross, 0) - coalesce(t.deductions, 0) as net, coalesce(p.paid, 0) as paid
  from hr_payslip s
  join hr_payroll_run r on r.id = s.run_id
  left join document rd on rd.id = r.document_id
  left join lateral (
    select sum(amount) filter (where kind in ('BASIC', 'ALLOWANCE', 'OVERTIME', 'COMMISSION', 'BONUS', 'OTHER_EARNING')) as gross,
           sum(amount) filter (where kind in ('ADVANCE', 'TAX', 'STATUTORY', 'OTHER_DEDUCTION')) as deductions
      from hr_payslip_line where payslip_id = s.id) t on true
  left join lateral (
    select sum(x.amount) as paid from hr_salary_payment x
      join document xd on xd.id = x.document_id and xd.status = 'POSTED'
     where x.payslip_id = s.id) p on true;

-- No advance gets back more than was lent, whichever way it came back.
-- Checked at commit, after a run posts or a repayment is written.
create or replace function fn_hr_advance_cap(p_advance uuid) returns void language plpgsql as $$
declare v_out numeric; v_no text;
begin
  select outstanding, advance_no into v_out, v_no from v_hr_advance where id = p_advance;
  if v_out < 0 then
    raise exception 'Advance % would be recovered beyond what was lent (by %)', v_no, -v_out;
  end if;
end $$;

create or replace function fn_hr_repayment_cap() returns trigger language plpgsql as $$
begin
  perform fn_hr_advance_cap(new.advance_id);
  return null;
end $$;
drop trigger if exists hr_repayment_cap on hr_advance_repayment;
create constraint trigger hr_repayment_cap after insert on hr_advance_repayment
  deferrable initially deferred for each row execute function fn_hr_repayment_cap();

create or replace function fn_hr_run_cap() returns trigger language plpgsql as $$
declare v_adv uuid;
begin
  if new.status = 'POSTED' then
    for v_adv in select distinct l.advance_id from hr_payslip_line l join hr_payslip s on s.id = l.payslip_id
                  where s.run_id = new.id and l.advance_id is not null loop
      perform fn_hr_advance_cap(v_adv);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists hr_run_cap on hr_payroll_run;
create constraint trigger hr_run_cap after update of status on hr_payroll_run
  deferrable initially deferred for each row execute function fn_hr_run_cap();

-- A posted run's payslips and lines are its record: frozen.
create or replace function fn_hr_posted_frozen() returns trigger language plpgsql as $$
declare v_run uuid;
begin
  if tg_table_name = 'hr_payslip' then v_run := coalesce(old.run_id, new.run_id);
  else select run_id into v_run from hr_payslip where id = coalesce(old.payslip_id, new.payslip_id);
  end if;
  if exists (select 1 from hr_payroll_run where id = v_run and status = 'POSTED') then
    raise exception 'A posted payroll cannot be changed; void its journal and prepare a new run';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists hr_payslip_frozen on hr_payslip;
create trigger hr_payslip_frozen before insert or update or delete on hr_payslip
  for each row execute function fn_hr_posted_frozen();
drop trigger if exists hr_payslip_line_frozen on hr_payslip_line;
create trigger hr_payslip_line_frozen before insert or update or delete on hr_payslip_line
  for each row execute function fn_hr_posted_frozen();
