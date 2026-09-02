-- 目標・ネクストアクションの期日をGoogleカレンダーへ同期するためのイベントID保持列
alter table goals add column google_event_id text;
alter table next_actions add column google_event_id text;
