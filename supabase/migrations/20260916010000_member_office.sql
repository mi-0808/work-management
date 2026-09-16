-- 事務管理用のメンバー情報（働く上限・支払メモ・振込先）。members と分けて、管理者と本人以外に見せない
create table if not exists member_office (
  member_id uuid primary key references members(id) on delete cascade,
  company_id uuid not null references companies(id),
  weekly_limit_hours numeric,
  monthly_limit_hours numeric,
  memo text,
  bank_name text,
  bank_branch text,
  bank_account_type text,
  bank_account_number text,
  bank_account_holder text,
  updated_at timestamptz not null default now()
);

alter table member_office enable row level security;

create policy member_office_admin on member_office for all
  using (is_admin_of(company_id))
  with check (is_admin_of(company_id));
create policy member_office_self_read on member_office for select
  using (member_id in (select id from members where user_id = auth.uid()));
