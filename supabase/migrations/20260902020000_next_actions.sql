-- ネクストアクションを目標から独立させる（goal_actions を廃止し、個人単位の next_actions に）

drop table if exists goal_actions;

create table if not exists next_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  member_id uuid not null references members(id),
  title text not null,
  status text not null default 'todo' check (status in ('todo','doing','done')),
  due_date date,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists next_actions_member_idx on next_actions (member_id, created_at);

alter table next_actions enable row level security;

-- 閲覧は同じ会社の全員、書き込みは本人のみ
create policy next_actions_select on next_actions for select
  using (company_id in (select my_company_ids()));
create policy next_actions_own on next_actions for all
  using (member_id in (select id from members where user_id = auth.uid()))
  with check (
    member_id in (select id from members where user_id = auth.uid())
    and company_id in (select my_company_ids())
  );
