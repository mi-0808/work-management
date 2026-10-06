-- 月額契約の金額（円）。null は時給制（hourly_rate × 実働で計算）
alter table members add column if not exists contract_amount integer check (contract_amount >= 0);
