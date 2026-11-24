-- AI提案の保存・判断と、変更履歴への記録
-- 判断（採用・修正・却下）は decide_ai_suggestion / decide_ai_suggestions_bulk だけが行い、
-- 値の反映と変更履歴の記録を1つのトランザクションで行う。
-- 判断中の提案IDは set_config('app.suggestion_id', id, true) で渡し、トリガーが履歴に付ける。

-- ---- 判断中の提案を読む ----

create function public.current_suggestion_id() returns uuid
language sql stable set search_path = ''
as $$
  select nullif(current_setting('app.suggestion_id', true), '')::uuid;
$$;

-- 判断中の提案のうち、この項目（と列）に当たるものを返す。無ければ null
create function public.current_suggestion_for(p_field text, p_column_id uuid)
returns public.ai_suggestions
language sql stable security definer set search_path = ''
as $$
  select s.*
  from public.ai_suggestions s
  where s.id = public.current_suggestion_id()
    and s.field = p_field
    and s.column_id is not distinct from p_column_id;
$$;

-- 変更履歴を1行書く。判断中の提案に当たれば、提案値と判断の結果も付ける
create function public.insert_change_log(
  p_dataset_id uuid, p_column_id uuid, p_column_name text, p_field text,
  p_old jsonb, p_new jsonb, p_note text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.ai_suggestions;
begin
  s := public.current_suggestion_for(p_field, p_column_id);
  insert into public.change_logs (
    dataset_id, column_id, column_name, field, old_value, new_value, note, changed_by,
    suggestion_id, suggested_value, ai_decision
  ) values (
    p_dataset_id, p_column_id, p_column_name, p_field, p_old, p_new,
    coalesce(p_note, case when s.id is not null then public.current_change_note() end),
    auth.uid(),
    s.id, s.suggested_value, s.decision
  );
end;
$$;

-- ---- 既存のトリガーと関数を、提案IDを付けて書くように置き換える ----

create or replace function public.log_dataset_changes() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  tracked text[] := array['name', 'description', 'domain', 'sensitivity', 'owner_name', 'steward_id',
    'usage_notes', 'source_system', 'update_frequency', 'status'];
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
  key text;
begin
  foreach key in array tracked loop
    if old_row -> key is distinct from new_row -> key then
      perform public.insert_change_log(
        new.id, null, null, key, old_row -> key, new_row -> key,
        case when key = 'status' then public.current_change_note() end
      );
    end if;
  end loop;
  return new;
end;
$$;

create or replace function public.log_column_changes() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  tracked text[] := array['description', 'sensitivity', 'is_pii'];
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
  key text;
  changed boolean := false;
begin
  foreach key in array tracked loop
    if old_row -> key is distinct from new_row -> key then
      perform public.insert_change_log(
        new.dataset_id, new.id, new.name, 'column.' || key, old_row -> key, new_row -> key, null
      );
      changed := true;
    end if;
  end loop;

  -- 列を変えたら、データセットの更新日も進める
  if changed then
    update public.datasets set updated_at = now() where id = new.dataset_id;
  end if;
  return new;
end;
$$;

-- 内容は 20261112000500 と同じ。履歴の書き込みだけ insert_change_log に変える
create or replace function public.set_dataset_tags(p_dataset_id uuid, p_names text[]) returns void
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

  perform public.insert_change_log(p_dataset_id, null, null, 'tags', to_jsonb(old_names), to_jsonb(new_names), null);

  update public.datasets set updated_at = now() where id = p_dataset_id;
end;
$$;

-- 未判断のAI提案が残っていたら、承認を依頼できない
create or replace function public.submit_for_review(p_dataset_id uuid) returns void
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
  if exists (select 1 from public.ai_suggestions where dataset_id = p_dataset_id and decision = 'pending') then
    raise exception '未判断のAI提案があります。採用・修正・却下してから依頼してください';
  end if;

  perform public.check_dataset_ready(p_dataset_id);

  update public.datasets
     set status = 'pending_review', submitted_by = auth.uid(), submitted_at = now()
   where id = p_dataset_id;
end;
$$;

-- ---- 提案の保存 ----

-- 下書きのデータセットでなければエラーにし、行をロックする
create function public.lock_draft_dataset(p_dataset_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ds_status text;
begin
  select status into ds_status from public.datasets where id = p_dataset_id for update;
  if not found then
    raise exception 'データセットが見つかりません';
  end if;
  if ds_status <> 'draft' then
    raise exception 'AI提案を扱えるのは下書きのデータセットだけです';
  end if;
end;
$$;

-- 提案を保存する。前回の未判断の提案は「置き換え済み」にする（採用率の計算から外れる）
-- p_items: [{ "field": ..., "column_name": ... | null, "suggested_value": ..., "reason": ... }]
create function public.save_ai_suggestions(
  p_dataset_id uuid, p_model text, p_prompt_version text, p_usage jsonb, p_items jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_run_id uuid;
  item jsonb;
  col_id uuid;
  col_name text;
  item_count integer := 0;
begin
  perform public.assert_steward();
  perform public.lock_draft_dataset(p_dataset_id);

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'AI提案の内容が空です';
  end if;

  update public.ai_suggestions
     set decision = 'superseded', decided_at = now()
   where dataset_id = p_dataset_id and decision = 'pending';

  insert into public.ai_suggestion_runs (dataset_id, model, prompt_version, input_tokens, output_tokens, requested_by)
  values (
    p_dataset_id, p_model, p_prompt_version,
    (p_usage ->> 'input_tokens')::integer, (p_usage ->> 'output_tokens')::integer, auth.uid()
  )
  returning id into v_run_id;

  for item in select * from jsonb_array_elements(p_items) loop
    col_id := null;
    col_name := null;
    if item ->> 'field' like 'column.%' then
      select c.id, c.name into col_id, col_name from public.dataset_columns c
       where c.dataset_id = p_dataset_id and c.name = item ->> 'column_name';
      if not found then
        raise exception 'AI提案の列「%」が見つかりません', item ->> 'column_name';
      end if;
    end if;

    insert into public.ai_suggestions (run_id, dataset_id, column_id, column_name, field, suggested_value, reason)
    values (v_run_id, p_dataset_id, col_id, col_name, item ->> 'field', item -> 'suggested_value', item ->> 'reason');
    item_count := item_count + 1;
  end loop;

  insert into public.change_logs (dataset_id, field, new_value, changed_by)
  values (
    p_dataset_id, 'ai_suggested',
    jsonb_build_object('count', item_count, 'model', p_model, 'prompt_version', p_prompt_version),
    auth.uid()
  );

  return v_run_id;
end;
$$;

-- ---- 提案の判断 ----

-- 比べるための形にそろえる：文字列は前後の空白を除き、配列は重複を除いて並べる。空は null
create function public.normalize_ai_value(p_field text, p_value jsonb) returns jsonb
language sql immutable set search_path = ''
as $$
  select case
    when p_value is null or p_value = 'null'::jsonb then null
    when p_field in ('tags', 'sensitivity') then (
      select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
      from (
        select distinct btrim(e) as v
        from jsonb_array_elements_text(p_value) as e
        where btrim(e) <> ''
      ) t
    )
    when jsonb_typeof(p_value) = 'string' then nullif(to_jsonb(btrim(p_value #>> '{}')), '""'::jsonb)
    else p_value
  end;
$$;

-- 項目の今の値（履歴の「変更前」と、値が変わらなかったときの記録に使う）
create function public.current_ai_field_value(s public.ai_suggestions) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  if s.field = 'tags' then
    select coalesce(jsonb_agg(t.name order by t.name), '[]'::jsonb) into result
    from public.dataset_tags dt join public.tags t on t.id = dt.tag_id
    where dt.dataset_id = s.dataset_id;
  elsif s.field like 'column.%' then
    select to_jsonb(c) -> substr(s.field, length('column.') + 1) into result
    from public.dataset_columns c where c.id = s.column_id;
  else
    select to_jsonb(d) -> s.field into result
    from public.datasets d where d.id = s.dataset_id;
  end if;
  return result;
end;
$$;

-- 確定値を本体に反映する。値の確認は各列の CHECK 制約と型変換に任せる
create function public.apply_ai_value(s public.ai_suggestions, p_value jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  case s.field
    when 'description' then
      update public.datasets set description = p_value #>> '{}' where id = s.dataset_id;
    when 'domain' then
      update public.datasets set domain = p_value #>> '{}' where id = s.dataset_id;
    when 'sensitivity' then
      update public.datasets
         set sensitivity = array(select jsonb_array_elements_text(p_value))
       where id = s.dataset_id;
    when 'tags' then
      perform public.set_dataset_tags(s.dataset_id, array(select jsonb_array_elements_text(p_value)));
    when 'column.description' then
      update public.dataset_columns set description = p_value #>> '{}' where id = s.column_id;
    when 'column.sensitivity' then
      update public.dataset_columns set sensitivity = p_value #>> '{}' where id = s.column_id;
    when 'column.is_pii' then
      perform public.set_column_pii(s.column_id, (p_value)::boolean);
  end case;
end;
$$;

-- 1件を判断する（単独・まとめての両方から使う）
create function public.decide_one_ai_suggestion(
  s public.ai_suggestions, p_decision text, p_final jsonb, p_bulk boolean
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_decision text := p_decision;
  v_final jsonb;
  v_current jsonb;
begin
  if v_decision not in ('accepted', 'modified', 'rejected') then
    raise exception '判断の値が正しくありません';
  end if;

  if v_decision = 'accepted' then
    v_final := s.suggested_value;
  elsif v_decision = 'modified' then
    v_final := public.normalize_ai_value(s.field, p_final);
    if v_final is null then
      raise exception '修正後の値を入力してください';
    end if;
    -- 提案と同じ値なら「採用」として数える
    if v_final = public.normalize_ai_value(s.field, s.suggested_value) then
      v_decision := 'accepted';
      v_final := s.suggested_value;
    end if;
  end if;

  update public.ai_suggestions
     set decision = v_decision, final_value = v_final,
         decided_by = auth.uid(), decided_at = now(), decided_in_bulk = p_bulk
   where id = s.id
   returning * into s;

  perform set_config('app.suggestion_id', s.id::text, true);
  if v_decision <> 'rejected' then
    perform public.apply_ai_value(s, v_final);
  end if;

  -- 値が変わらずトリガーが動かなかったとき（却下、今と同じ値の採用）は、ここで履歴を書く
  if not exists (select 1 from public.change_logs where suggestion_id = s.id) then
    v_current := public.current_ai_field_value(s);
    perform public.insert_change_log(
      s.dataset_id, s.column_id, s.column_name, s.field, v_current, v_current, null
    );
  end if;
  perform set_config('app.suggestion_id', '', true);
end;
$$;

-- 提案を1件判断する
-- p_decision: accepted（採用）／modified（修正して採用。p_final に値）／rejected（却下）
create function public.decide_ai_suggestion(p_suggestion_id uuid, p_decision text, p_final jsonb default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.ai_suggestions;
begin
  perform public.assert_steward();

  select * into s from public.ai_suggestions where id = p_suggestion_id;
  if not found then
    raise exception 'AI提案が見つかりません';
  end if;
  perform public.lock_draft_dataset(s.dataset_id);
  -- データセットをロックしてから、もう一度読む（同時に判断されていないか）
  select * into s from public.ai_suggestions where id = p_suggestion_id;
  if s.decision <> 'pending' then
    raise exception 'このAI提案はすでに判断済みです';
  end if;

  perform public.decide_one_ai_suggestion(s, p_decision, p_final, false);
end;
$$;

-- 未判断の提案をまとめて採用・却下する。提案ごとに判断結果と履歴を残す
-- 1件でも反映できなければ、全部取り消す（1つのトランザクション）
create function public.decide_ai_suggestions_bulk(p_dataset_id uuid, p_decision text) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  s public.ai_suggestions;
  done integer := 0;
begin
  perform public.assert_steward();
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'まとめて行えるのは採用か却下だけです';
  end if;
  perform public.lock_draft_dataset(p_dataset_id);

  perform set_config(
    'app.change_note',
    case p_decision when 'accepted' then 'まとめて採用' else 'まとめて却下' end,
    true
  );

  -- 列の「個人情報」と「機微度」は、途中で CHECK（個人情報の列は公開にできない）を破らない順に反映する
  --   個人情報を外す → 機微度 → 個人情報にする → 説明
  for s in
    select * from public.ai_suggestions
     where dataset_id = p_dataset_id and decision = 'pending'
     order by
       column_id nulls first,
       case
         when field = 'column.is_pii' and suggested_value = 'false'::jsonb then 0
         when field = 'column.sensitivity' then 1
         when field = 'column.is_pii' then 2
         else 3
       end,
       field
  loop
    perform public.decide_one_ai_suggestion(s, p_decision, null, true);
    done := done + 1;
  end loop;

  perform set_config('app.change_note', '', true);
  return done;
end;
$$;

-- ---- 実行権限 ----

revoke execute on function
  public.current_suggestion_id(),
  public.current_suggestion_for(text, uuid),
  public.insert_change_log(uuid, uuid, text, text, jsonb, jsonb, text),
  public.lock_draft_dataset(uuid),
  public.normalize_ai_value(text, jsonb),
  public.current_ai_field_value(public.ai_suggestions),
  public.apply_ai_value(public.ai_suggestions, jsonb),
  public.decide_one_ai_suggestion(public.ai_suggestions, text, jsonb, boolean)
  from public, anon, authenticated;

revoke execute on function
  public.save_ai_suggestions(uuid, text, text, jsonb, jsonb),
  public.decide_ai_suggestion(uuid, text, jsonb),
  public.decide_ai_suggestions_bulk(uuid, text)
  from public, anon;

grant execute on function
  public.save_ai_suggestions(uuid, text, text, jsonb, jsonb),
  public.decide_ai_suggestion(uuid, text, jsonb),
  public.decide_ai_suggestions_bulk(uuid, text)
  to authenticated;
