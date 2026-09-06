-- 経費管理v2: 承認フロー・店情報(マップ用)・固定費・会社予算

alter table money_expenses
  add column if not exists status text not null default 'approved'
    check (status in ('submitted','approved','rejected')), -- 承認待ち/承認済み/差し戻し（既存行は承認済み扱い）
  add column if not exists store text,
  add column if not exists address text,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists recurring_id uuid; -- 固定費から自動生成された行の印

-- 管理者は会社提出経費を承認・差し戻しできる
create policy money_expenses_admin_update on money_expenses for update
  using (scope = 'company' and is_admin_of(company_id))
  with check (scope = 'company' and is_admin_of(company_id));

-- 会社の月間経費予算（円。nullなら未設定）
alter table companies add column if not exists expense_budget integer;

-- 固定費・定期支出（毎月 day_of_month 日に経費行を自動生成）
create table if not exists money_recurring (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  member_id uuid not null references members(id),
  scope text not null check (scope in ('company','personal')),
  label text not null,
  amount integer not null,
  day_of_month int not null default 1 check (day_of_month between 1 and 28),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table money_recurring enable row level security;
create policy money_recurring_own on money_recurring for all
  using (member_id in (select id from members where user_id = auth.uid()))
  with check (
    member_id in (select id from members where user_id = auth.uid())
    and company_id in (select my_company_ids())
  );
