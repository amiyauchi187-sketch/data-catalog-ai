-- 権限とRLS
-- Supabase は既定で anon と authenticated に全権限を付けるため、いったん外してから必要な分だけ付ける。

revoke all on public.datasets, public.dataset_columns, public.dataset_column_samples,
  public.tags, public.dataset_tags, public.change_logs
  from anon, authenticated;

-- 読み取り
grant select on public.datasets, public.dataset_columns, public.dataset_column_samples,
  public.tags, public.dataset_tags, public.change_logs
  to authenticated;

-- 書き込み：手入力の列だけ。状態・承認・登録者の列はDB関数だけが変える
grant update (name, description, domain, sensitivity, owner_name, steward_id, usage_notes,
  source_system, update_frequency)
  on public.datasets to authenticated;
grant delete on public.datasets to authenticated;
grant update (description, sensitivity) on public.dataset_columns to authenticated;

alter table public.datasets enable row level security;
alter table public.dataset_columns enable row level security;
alter table public.dataset_column_samples enable row level security;
alter table public.tags enable row level security;
alter table public.dataset_tags enable row level security;
alter table public.change_logs enable row level security;

-- datasets
create policy "公開中は全員、それ以外はスチュワードが読める"
  on public.datasets for select to authenticated
  using (status = 'published' or (select public.is_steward()));

create policy "スチュワードは下書きを編集できる"
  on public.datasets for update to authenticated
  using ((select public.is_steward()) and status = 'draft')
  with check ((select public.is_steward()) and status = 'draft');

create policy "スチュワードは一度も公開していない下書きを削除できる"
  on public.datasets for delete to authenticated
  using ((select public.is_steward()) and status = 'draft' and first_published_at is null);

-- dataset_columns：親を読める人が読める。サブクエリにも datasets の RLS がかかる
create policy "親データセットを読める人が列を読める"
  on public.dataset_columns for select to authenticated
  using (exists (select 1 from public.datasets d where d.id = dataset_columns.dataset_id));

create policy "スチュワードは下書きの列を編集できる"
  on public.dataset_columns for update to authenticated
  using (
    (select public.is_steward())
    and exists (select 1 from public.datasets d where d.id = dataset_columns.dataset_id and d.status = 'draft')
  )
  with check (
    (select public.is_steward())
    and exists (select 1 from public.datasets d where d.id = dataset_columns.dataset_id and d.status = 'draft')
  );

-- dataset_column_samples：機微度に応じて閲覧者から隠す
--   機密を含むデータセット → 全列隠す
--   個人情報の列（is_pii）と機密の列 → その列だけ隠す
create policy "サンプル値の読み取り"
  on public.dataset_column_samples for select to authenticated
  using (
    (select public.is_steward())
    or exists (
      select 1
      from public.dataset_columns c
      join public.datasets d on d.id = c.dataset_id
      where c.id = dataset_column_samples.column_id
        and d.status = 'published'
        and not ('confidential' = any (d.sensitivity))
        and c.sensitivity is distinct from 'confidential'
        and not c.is_pii
    )
  );

-- tags / dataset_tags
create policy "タグはログイン済み全員が読める"
  on public.tags for select to authenticated
  using (true);

create policy "親データセットを読める人がタグの紐づけを読める"
  on public.dataset_tags for select to authenticated
  using (exists (select 1 from public.datasets d where d.id = dataset_tags.dataset_id));

-- change_logs
create policy "変更履歴はスチュワードだけが読める"
  on public.change_logs for select to authenticated
  using ((select public.is_steward()));
