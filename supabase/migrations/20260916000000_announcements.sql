-- 管理者からメンバーへのお知らせ（ホームに表示）
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  author_member_id uuid not null references members(id),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists announcements_company_idx on announcements (company_id, created_at desc);

alter table announcements enable row level security;

-- 閲覧は同じ会社の全員、配信・削除は管理者のみ
create policy announcements_select on announcements for select
  using (company_id in (select my_company_ids()));
create policy announcements_admin on announcements for all
  using (is_admin_of(company_id))
  with check (is_admin_of(company_id));
