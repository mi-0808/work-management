-- 収入（売上）の手入力と扶養の壁

-- 請求書以外の売上・収入を月単位で手入力する
create table if not exists money_incomes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  member_id uuid not null references members(id),
  month text not null, -- YYYY-MM
  label text not null,
  amount integer not null,
  created_at timestamptz not null default now()
);
alter table money_incomes enable row level security;
create policy money_incomes_own on money_incomes for all
  using (member_id in (select id from members where user_id = auth.uid()))
  with check (
    member_id in (select id from members where user_id = auth.uid())
    and company_id in (select my_company_ids())
  );

-- 扶養の壁（年収の上限目安・円）。nullは未設定または対象外
alter table money_profiles add column if not exists wall_amount integer;
