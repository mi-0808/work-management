-- お金管理モード: お金プロフィールと経費（レシート添付つき）

create table if not exists money_profiles (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) unique,
  stance text not null check (stance in ('president','sole_proprietor','part_time','employee')),
  created_at timestamptz not null default now()
);

create table if not exists money_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  member_id uuid not null references members(id),
  scope text not null check (scope in ('company','personal')), -- 会社に提出する経費 / 個人の出費
  occurred_on date not null,
  label text not null,
  amount integer not null,
  receipt_path text,                        -- receiptsバケット内のパス
  invoice_id uuid references invoices(id),  -- 稼働と請求への紐付け（任意）
  created_at timestamptz not null default now()
);

create index if not exists money_expenses_member_idx on money_expenses (member_id, occurred_on);
create index if not exists money_expenses_company_idx on money_expenses (company_id, scope, occurred_on);

alter table money_profiles enable row level security;
alter table money_expenses enable row level security;

-- お金プロフィール: 本人のみ
create policy money_profiles_own on money_profiles for all
  using (member_id in (select id from members where user_id = auth.uid()))
  with check (member_id in (select id from members where user_id = auth.uid()));

-- 経費: 本人は全操作。会社提出分（scope='company'）は管理者も閲覧可
create policy money_expenses_own on money_expenses for all
  using (member_id in (select id from members where user_id = auth.uid()))
  with check (
    member_id in (select id from members where user_id = auth.uid())
    and company_id in (select my_company_ids())
  );
create policy money_expenses_admin_select on money_expenses for select
  using (scope = 'company' and is_admin_of(company_id));

-- レシート用のprivateバケット。閲覧は署名URL経由
insert into storage.buckets (id, name, public)
  values ('receipts', 'receipts', false)
  on conflict (id) do nothing;

-- パス構成: <user_id>/<uuid>-<filename>。本人はフルアクセス、
-- 管理者は自社メンバーの会社提出経費に紐づくレシートを閲覧できる
create policy receipts_own on storage.objects for all
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy receipts_admin_read on storage.objects for select
  using (
    bucket_id = 'receipts'
    and exists (
      select 1 from money_expenses e
      where e.receipt_path = name and e.scope = 'company' and is_admin_of(e.company_id)
    )
  );
