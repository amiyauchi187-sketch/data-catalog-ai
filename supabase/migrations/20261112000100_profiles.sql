-- 利用者と役割
-- 役割は viewer（閲覧者）と steward（データスチュワード）の2種類。1人1つ。

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role text not null default 'viewer' check (role in ('viewer', 'steward')),
  created_at timestamptz not null default now()
);

comment on table public.profiles is '利用者。auth.users への追加時にトリガーで作る。role の変更はSQLで行う';

-- auth.users に利用者が追加されたら profiles を作る
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS から使う権限判定。profiles の RLS に左右されないよう security definer にする
create function public.is_steward() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'steward'
  );
$$;

-- 権限：画面からは読み取りだけ
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

alter table public.profiles enable row level security;

create policy "利用者はログイン済み全員が読める"
  on public.profiles for select to authenticated
  using (true);

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_steward() from public, anon;
grant execute on function public.is_steward() to authenticated;
