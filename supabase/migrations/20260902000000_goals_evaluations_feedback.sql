-- 個人目標・評価・フィードバック投稿
-- 既存ヘルパー: my_company_ids() = 自分が属する company_id 一覧, is_admin_of(company_id) = 管理者判定

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  member_id uuid not null references members(id),
  period_type text not null check (period_type in ('week','month','custom')),
  due_date date not null,
  title text not null,
  body text,
  status text not null default 'open' check (status in ('open','done','dropped')),
  self_review text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists goal_evaluations (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  evaluator_member_id uuid not null references members(id),
  rating int check (rating between 1 and 5),
  comment text not null,
  created_at timestamptz not null default now()
);

create table if not exists feedback_posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  target_member_id uuid not null references members(id),
  author_member_id uuid not null references members(id),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists goals_member_idx on goals (member_id, due_date);
create index if not exists goal_evaluations_goal_idx on goal_evaluations (goal_id);
create index if not exists feedback_posts_target_idx on feedback_posts (target_member_id, created_at);

alter table goals enable row level security;
alter table goal_evaluations enable row level security;
alter table feedback_posts enable row level security;

-- goals: 同じ会社の全員が閲覧可、書き込みは本人のみ
create policy goals_select on goals for select
  using (company_id in (select my_company_ids()));
create policy goals_own on goals for all
  using (member_id in (select id from members where user_id = auth.uid()))
  with check (
    member_id in (select id from members where user_id = auth.uid())
    and company_id in (select my_company_ids())
  );

-- goal_evaluations: 同じ会社の全員が閲覧可、投稿は管理者のみ（evaluator は自分）
create policy goal_evaluations_select on goal_evaluations for select
  using (goal_id in (select id from goals where company_id in (select my_company_ids())));
create policy goal_evaluations_insert on goal_evaluations for insert
  with check (
    evaluator_member_id in (select id from members where user_id = auth.uid())
    and goal_id in (select g.id from goals g where is_admin_of(g.company_id))
  );
create policy goal_evaluations_delete on goal_evaluations for delete
  using (evaluator_member_id in (select id from members where user_id = auth.uid()));

-- feedback_posts: 同じ会社の全員が閲覧可、投稿は会社メンバー（author は自分）、削除は投稿者本人
create policy feedback_posts_select on feedback_posts for select
  using (company_id in (select my_company_ids()));
create policy feedback_posts_insert on feedback_posts for insert
  with check (
    author_member_id in (select id from members where user_id = auth.uid())
    and company_id in (select my_company_ids())
    and target_member_id in (select id from members where company_id in (select my_company_ids()))
  );
create policy feedback_posts_delete on feedback_posts for delete
  using (author_member_id in (select id from members where user_id = auth.uid()));
