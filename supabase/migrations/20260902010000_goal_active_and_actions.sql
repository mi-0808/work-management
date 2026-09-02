-- 目標に「実行中(active)」状態と、目標内のネクストアクション（チェックリスト）を追加

alter table goals drop constraint goals_status_check;
alter table goals add constraint goals_status_check
  check (status in ('open','active','done','dropped'));

create table if not exists goal_actions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists goal_actions_goal_idx on goal_actions (goal_id, created_at);

alter table goal_actions enable row level security;

-- 閲覧は同じ会社の全員、書き込みは目標の本人のみ
create policy goal_actions_select on goal_actions for select
  using (goal_id in (select id from goals where company_id in (select my_company_ids())));
create policy goal_actions_own on goal_actions for all
  using (goal_id in (
    select g.id from goals g
    where g.member_id in (select id from members where user_id = auth.uid())
  ))
  with check (goal_id in (
    select g.id from goals g
    where g.member_id in (select id from members where user_id = auth.uid())
  ));
