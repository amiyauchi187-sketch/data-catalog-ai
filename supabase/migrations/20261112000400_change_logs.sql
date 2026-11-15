-- 変更履歴をトリガーで記録する
-- 差し戻しや廃止の理由は、DB関数が set_config('app.change_note', 理由, true) で渡す

-- そのトランザクションで渡された理由を返す（無ければ null）
create function public.current_change_note() returns text
language sql stable set search_path = ''
as $$
  select nullif(current_setting('app.change_note', true), '');
$$;

create function public.log_dataset_changes() returns trigger
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
      insert into public.change_logs (dataset_id, field, old_value, new_value, note, changed_by)
      values (
        new.id, key, old_row -> key, new_row -> key,
        case when key = 'status' then public.current_change_note() end,
        auth.uid()
      );
    end if;
  end loop;
  return new;
end;
$$;

create trigger datasets_log_changes
  after update on public.datasets
  for each row execute function public.log_dataset_changes();

create function public.log_column_changes() returns trigger
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
      insert into public.change_logs (dataset_id, column_id, column_name, field, old_value, new_value, changed_by)
      values (new.dataset_id, new.id, new.name, 'column.' || key, old_row -> key, new_row -> key, auth.uid());
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

create trigger dataset_columns_log_changes
  after update on public.dataset_columns
  for each row execute function public.log_column_changes();

revoke execute on function public.log_dataset_changes() from public, anon, authenticated;
revoke execute on function public.log_column_changes() from public, anon, authenticated;
revoke execute on function public.current_change_note() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.check_status_transition() from public, anon, authenticated;
