-- AIによるメタデータ提案（要件5.6）
-- 提案は項目ごとに1行で持ち、スチュワードが採用・修正・却下する。
-- 提案はデータセット本体とは別のテーブルに置くので、採用されるまで本体の項目には入らない。

-- AIを1回呼ぶごとに1行
create table public.ai_suggestion_runs (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.datasets (id) on delete cascade,
  model text not null,
  prompt_version text not null,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  requested_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index ai_suggestion_runs_dataset_idx on public.ai_suggestion_runs (dataset_id, created_at desc);

-- 提案（項目ごとに1行）
create table public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_suggestion_runs (id) on delete cascade,
  dataset_id uuid not null references public.datasets (id) on delete cascade,
  column_id uuid references public.dataset_columns (id) on delete cascade,
  column_name text,
  -- change_logs.field と同じ名前にする
  field text not null check (field in (
    'description', 'domain', 'tags', 'sensitivity',
    'column.description', 'column.sensitivity', 'column.is_pii'
  )),
  suggested_value jsonb not null,
  reason text,
  decision text not null default 'pending'
    check (decision in ('pending', 'accepted', 'modified', 'rejected', 'superseded')),
  final_value jsonb,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decided_in_bulk boolean not null default false,
  created_at timestamptz not null default now(),

  -- 列の項目なら列があり、データセットの項目なら列は空
  check ((field like 'column.%') = (column_id is not null)),
  -- 判断の結果ごとに、確定値と判断者をそろえる
  check (case decision
    when 'pending'    then final_value is null and decided_by is null and decided_at is null and not decided_in_bulk
    when 'superseded' then final_value is null and decided_at is not null
    when 'accepted'   then final_value = suggested_value and decided_by is not null and decided_at is not null
    when 'modified'   then final_value is not null and final_value <> suggested_value
                           and decided_by is not null and decided_at is not null
    else final_value is null and decided_by is not null and decided_at is not null
  end)
);

create index ai_suggestions_dataset_idx on public.ai_suggestions (dataset_id, decision);
create index ai_suggestions_run_idx on public.ai_suggestions (run_id);

-- 変更履歴に、AIの提案値と判断の結果を残す
alter table public.change_logs
  add column suggestion_id uuid references public.ai_suggestions (id) on delete set null,
  add column suggested_value jsonb,
  add column ai_decision text check (ai_decision in ('accepted', 'modified', 'rejected'));

-- 権限とRLS：読めるのはスチュワードだけ。書き込みはDB関数だけが行う
revoke all on public.ai_suggestion_runs, public.ai_suggestions from anon, authenticated;
grant select on public.ai_suggestion_runs, public.ai_suggestions to authenticated;

alter table public.ai_suggestion_runs enable row level security;
alter table public.ai_suggestions enable row level security;

create policy "スチュワードはAI提案の実行記録を読める"
  on public.ai_suggestion_runs for select to authenticated
  using ((select public.is_steward()));

create policy "スチュワードはAI提案を読める"
  on public.ai_suggestions for select to authenticated
  using ((select public.is_steward()));

-- 採用率の集計。判断済み（採用・修正・却下）だけを数え、未判断と置き換えられた提案は除く
-- security_invoker なので、閲覧者が読んでも RLS で0件になる
create view public.ai_suggestion_stats
with (security_invoker = true)
as
select
  s.field,
  r.model,
  r.prompt_version,
  count(*) filter (where s.decision = 'accepted')::integer as accepted,
  count(*) filter (where s.decision = 'modified')::integer as modified,
  count(*) filter (where s.decision = 'rejected')::integer as rejected,
  count(*) filter (where s.decided_in_bulk)::integer as decided_in_bulk
from public.ai_suggestions s
join public.ai_suggestion_runs r on r.id = s.run_id
where s.decision in ('accepted', 'modified', 'rejected')
group by s.field, r.model, r.prompt_version;

revoke all on public.ai_suggestion_stats from anon, authenticated;
grant select on public.ai_suggestion_stats to authenticated;
