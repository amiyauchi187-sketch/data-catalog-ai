-- データセットを操作するDB関数
-- security definer の関数は、中で必ずスチュワードかどうかを確認する

-- スチュワードでなければエラーにする
create function public.assert_steward() returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_steward() then
    raise exception 'この操作はスチュワードだけが行えます' using errcode = '42501';
  end if;
end;
$$;

-- 個人情報の列のサンプルを伏せる（null と空文字はそのまま）
create function public.mask_sample_values(vals jsonb) returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_agg(
    case
      when v = 'null'::jsonb or v = '""'::jsonb then v
      else '"***"'::jsonb
    end order by ord
  ), '[]'::jsonb)
  from jsonb_array_elements(vals) with ordinality as t(v, ord);
$$;

-- 承認依頼・承認の前に、データセットと列の整合を確認する
create function public.check_dataset_ready(p_dataset_id uuid) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare
  ds public.datasets;
  col_name text;
  has_pii boolean;
  has_confidential_col boolean;
  has_internal_col boolean;
begin
  select * into ds from public.datasets where id = p_dataset_id;

  if coalesce(btrim(ds.description), '') = '' then
    raise exception '説明が入力されていません';
  end if;
  if ds.domain is null then
    raise exception 'データドメインが選ばれていません';
  end if;
  if cardinality(ds.sensitivity) = 0 then
    raise exception '機微度が選ばれていません';
  end if;
  if ds.steward_id is null then
    raise exception '担当スチュワードが選ばれていません';
  end if;
  if not exists (select 1 from public.profiles where id = ds.steward_id and role = 'steward') then
    raise exception '担当スチュワードには、スチュワードの役割を持つ利用者を選んでください';
  end if;

  select name into col_name
  from public.dataset_columns
  where dataset_id = p_dataset_id and sensitivity is null
  order by position limit 1;
  if col_name is not null then
    raise exception '列「%」の機微度が未設定です', col_name;
  end if;

  select bool_or(is_pii), bool_or(sensitivity = 'confidential'), bool_or(sensitivity = 'internal')
    into has_pii, has_confidential_col, has_internal_col
  from public.dataset_columns where dataset_id = p_dataset_id;

  if has_pii and not ('personal' = any (ds.sensitivity)) then
    raise exception '個人情報の列があるため、データセットの機微度に「個人情報を含む」が必要です';
  end if;
  if not coalesce(has_pii, false) and 'personal' = any (ds.sensitivity) then
    raise exception '機微度が「個人情報を含む」ですが、個人情報の列が1つもありません';
  end if;
  if has_confidential_col and not ('confidential' = any (ds.sensitivity)) then
    raise exception '機密の列があるため、データセットの機微度に「機密」が必要です';
  end if;
  if has_internal_col and 'public' = any (ds.sensitivity) then
    raise exception '社内の列があるため、データセットの機微度を「公開」にはできません';
  end if;
end;
$$;

-- CSVから読み取った内容で、データセット・列・サンプルを1つのトランザクションで登録する
-- payload: { name, source_file_name, encoding, row_count, sample_count,
--            columns: [{ position, name, data_type, null_count, null_rate, distinct_count, is_pii, samples: [...] }] }
create function public.create_dataset(payload jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
  new_column_id uuid;
  col jsonb;
  samples jsonb;
  n_samples integer := (payload ->> 'sample_count')::integer;
  n_columns integer := jsonb_array_length(payload -> 'columns');
  v_is_pii boolean;
begin
  perform public.assert_steward();

  if n_columns is null or n_columns = 0 then
    raise exception '列が1つもありません';
  end if;

  insert into public.datasets (name, source_file_name, encoding, row_count, column_count, sample_count, created_by)
  values (
    btrim(payload ->> 'name'),
    payload ->> 'source_file_name',
    payload ->> 'encoding',
    (payload ->> 'row_count')::integer,
    n_columns,
    n_samples,
    auth.uid()
  )
  returning id into new_id;

  for col in select * from jsonb_array_elements(payload -> 'columns') loop
    samples := coalesce(col -> 'samples', '[]'::jsonb);
    if jsonb_typeof(samples) <> 'array' or jsonb_array_length(samples) <> n_samples then
      raise exception '列「%」のサンプルの件数が % 件ではありません', col ->> 'name', n_samples;
    end if;
    if exists (select 1 from jsonb_array_elements(samples) v where jsonb_typeof(v) not in ('string', 'null')) then
      raise exception '列「%」のサンプルに文字列以外の値があります', col ->> 'name';
    end if;

    v_is_pii := coalesce((col ->> 'is_pii')::boolean, false);

    insert into public.dataset_columns
      (dataset_id, position, name, data_type, null_count, null_rate, distinct_count, is_pii)
    values (
      new_id,
      (col ->> 'position')::integer,
      col ->> 'name',
      col ->> 'data_type',
      (col ->> 'null_count')::integer,
      (col ->> 'null_rate')::numeric,
      (col ->> 'distinct_count')::integer,
      v_is_pii
    )
    returning id into new_column_id;

    -- 送信側で伏せ忘れていても、個人情報の列はここで必ず伏せる
    insert into public.dataset_column_samples (column_id, sample_values)
    values (new_column_id, case when v_is_pii then public.mask_sample_values(samples) else samples end);
  end loop;

  insert into public.change_logs (dataset_id, field, changed_by)
  values (new_id, 'created', auth.uid());

  return new_id;
end;
$$;

-- 下書きを差し戻す・公開中を直すときの共通処理
create function public.move_to_draft(p_dataset_id uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('app.change_note', p_note, true);
  update public.datasets
     set status = 'draft',
         submitted_by = null, submitted_at = null,
         approved_by = null, approved_at = null
   where id = p_dataset_id;
end;
$$;

-- 個人情報の列の指定を変える。true にするとサンプルを *** に置き換える
create function public.set_column_pii(p_column_id uuid, p_is_pii boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  col public.dataset_columns;
  ds_status text;
begin
  perform public.assert_steward();

  select * into col from public.dataset_columns where id = p_column_id;
  if not found then
    raise exception '列が見つかりません';
  end if;
  select status into ds_status from public.datasets where id = col.dataset_id for update;

  if col.is_pii = p_is_pii then
    return;
  end if;

  if not p_is_pii then
    if ds_status <> 'draft' then
      raise exception '個人情報の指定を外せるのは下書きのときだけです';
    end if;
    -- 伏せた値は元に戻らない（原本を保存していないため）
    update public.dataset_columns set is_pii = false where id = p_column_id;
    return;
  end if;

  -- 伏せる前の値は履歴に残さない
  update public.dataset_column_samples
     set sample_values = public.mask_sample_values(sample_values)
   where column_id = p_column_id;
  insert into public.change_logs (dataset_id, column_id, column_name, field, changed_by)
  values (col.dataset_id, col.id, col.name, 'column.sample_masked', auth.uid());

  update public.dataset_columns
     set is_pii = true,
         sensitivity = case when sensitivity = 'public' then 'internal' else sensitivity end
   where id = p_column_id;

  -- 承認待ち・公開中なら、整合が崩れるので下書きに戻して承認をやり直す
  if ds_status in ('pending_review', 'published') then
    perform public.move_to_draft(col.dataset_id, '個人情報の列を追加したため下書きに戻しました');
  end if;
end;
$$;

-- タグを差し替える。無いタグは作る
create function public.set_dataset_tags(p_dataset_id uuid, p_names text[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ds_status text;
  old_names text[];
  new_names text[];
begin
  perform public.assert_steward();

  select status into ds_status from public.datasets where id = p_dataset_id for update;
  if not found then
    raise exception 'データセットが見つかりません';
  end if;
  if ds_status <> 'draft' then
    raise exception 'タグを変えられるのは下書きのときだけです';
  end if;

  select coalesce(array_agg(distinct btrim(n) order by btrim(n)), '{}')
    into new_names
  from unnest(coalesce(p_names, '{}')) as n
  where btrim(n) <> '';

  select coalesce(array_agg(t.name order by t.name), '{}')
    into old_names
  from public.dataset_tags dt join public.tags t on t.id = dt.tag_id
  where dt.dataset_id = p_dataset_id;

  if old_names = new_names then
    return;
  end if;

  insert into public.tags (name)
  select unnest(new_names)
  on conflict (name) do nothing;

  delete from public.dataset_tags where dataset_id = p_dataset_id;
  insert into public.dataset_tags (dataset_id, tag_id)
  select p_dataset_id, t.id from public.tags t where t.name = any (new_names);

  insert into public.change_logs (dataset_id, field, old_value, new_value, changed_by)
  values (p_dataset_id, 'tags', to_jsonb(old_names), to_jsonb(new_names), auth.uid());

  update public.datasets set updated_at = now() where id = p_dataset_id;
end;
$$;

-- 承認を依頼する
create function public.submit_for_review(p_dataset_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ds_status text;
begin
  perform public.assert_steward();

  select status into ds_status from public.datasets where id = p_dataset_id for update;
  if not found then
    raise exception 'データセットが見つかりません';
  end if;
  if ds_status <> 'draft' then
    raise exception '承認を依頼できるのは下書きだけです';
  end if;

  perform public.check_dataset_ready(p_dataset_id);

  update public.datasets
     set status = 'pending_review', submitted_by = auth.uid(), submitted_at = now()
   where id = p_dataset_id;
end;
$$;

-- 承認して公開する。登録者と承認依頼者は承認できない
create function public.approve_dataset(p_dataset_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ds public.datasets;
begin
  perform public.assert_steward();

  select * into ds from public.datasets where id = p_dataset_id for update;
  if not found then
    raise exception 'データセットが見つかりません';
  end if;
  if ds.status <> 'pending_review' then
    raise exception '承認できるのは承認待ちのデータセットだけです';
  end if;
  if auth.uid() = ds.created_by or auth.uid() = ds.submitted_by then
    raise exception '自分が登録または承認依頼したデータセットは承認できません' using errcode = '42501';
  end if;

  perform public.check_dataset_ready(p_dataset_id);

  update public.datasets
     set status = 'published',
         approved_by = auth.uid(),
         approved_at = now(),
         first_published_at = coalesce(first_published_at, now())
   where id = p_dataset_id;
end;
$$;

-- 承認待ち・公開中から下書きに戻す（差し戻し、取り下げ、修正）
create function public.return_to_draft(p_dataset_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ds_status text;
begin
  perform public.assert_steward();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception '下書きに戻す理由を入力してください';
  end if;

  select status into ds_status from public.datasets where id = p_dataset_id for update;
  if not found then
    raise exception 'データセットが見つかりません';
  end if;
  if ds_status not in ('pending_review', 'published') then
    raise exception '下書きに戻せるのは承認待ちか公開中のデータセットだけです';
  end if;

  perform public.move_to_draft(p_dataset_id, btrim(p_reason));
end;
$$;

-- 公開中のデータセットを廃止する
create function public.retire_dataset(p_dataset_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ds_status text;
begin
  perform public.assert_steward();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception '廃止する理由を入力してください';
  end if;

  select status into ds_status from public.datasets where id = p_dataset_id for update;
  if not found then
    raise exception 'データセットが見つかりません';
  end if;
  if ds_status <> 'published' then
    raise exception '廃止できるのは公開中のデータセットだけです';
  end if;

  perform set_config('app.change_note', btrim(p_reason), true);
  update public.datasets
     set status = 'retired', retired_by = auth.uid(), retired_at = now()
   where id = p_dataset_id;
end;
$$;

-- 検索。RLS をそのまま効かせるため security invoker にする
create function public.search_datasets(
  p_q text default null,
  p_domains text[] default null,
  p_sensitivities text[] default null,
  p_statuses text[] default null
) returns setof public.datasets
language plpgsql stable security invoker set search_path = ''
as $$
declare
  pattern text;
begin
  if coalesce(btrim(p_q), '') <> '' then
    -- % と _ と \ をエスケープして、部分一致にする
    pattern := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select d.*
  from public.datasets d
  where (pattern is null
      or d.name ilike pattern
      or d.description ilike pattern
      or exists (
        select 1 from public.dataset_tags dt join public.tags t on t.id = dt.tag_id
        where dt.dataset_id = d.id and t.name ilike pattern)
      or exists (
        select 1 from public.dataset_columns c
        where c.dataset_id = d.id and c.name ilike pattern))
    and (coalesce(cardinality(p_domains), 0) = 0 or d.domain = any (p_domains))
    and (coalesce(cardinality(p_sensitivities), 0) = 0 or d.sensitivity && p_sensitivities)
    and (coalesce(cardinality(p_statuses), 0) = 0 or d.status = any (p_statuses))
  order by d.updated_at desc;
end;
$$;

-- 実行権限：内部用の関数は誰にも付けず、画面から呼ぶ関数だけ authenticated に付ける
revoke execute on function
  public.assert_steward(),
  public.mask_sample_values(jsonb),
  public.check_dataset_ready(uuid),
  public.move_to_draft(uuid, text)
  from public, anon, authenticated;

revoke execute on function
  public.create_dataset(jsonb),
  public.set_column_pii(uuid, boolean),
  public.set_dataset_tags(uuid, text[]),
  public.submit_for_review(uuid),
  public.approve_dataset(uuid),
  public.return_to_draft(uuid, text),
  public.retire_dataset(uuid, text),
  public.search_datasets(text, text[], text[], text[])
  from public, anon;

grant execute on function
  public.create_dataset(jsonb),
  public.set_column_pii(uuid, boolean),
  public.set_dataset_tags(uuid, text[]),
  public.submit_for_review(uuid),
  public.approve_dataset(uuid),
  public.return_to_draft(uuid, text),
  public.retire_dataset(uuid, text),
  public.search_datasets(text, text[], text[], text[])
  to authenticated;
