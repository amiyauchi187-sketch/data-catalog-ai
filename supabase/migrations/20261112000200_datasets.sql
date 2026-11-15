-- データセット、列、列ごとのサンプル、タグ、変更履歴のテーブル

create table public.datasets (
  id uuid primary key default gen_random_uuid(),

  -- 業務メタデータ
  name text not null check (btrim(name) <> ''),
  description text,
  domain text check (domain in ('customer', 'sales', 'product', 'store', 'hr')),
  sensitivity text[] not null default '{}',
  owner_name text,
  steward_id uuid references public.profiles (id),
  usage_notes text,

  -- 技術メタデータ
  row_count integer not null check (row_count >= 0),
  column_count integer not null check (column_count >= 1),
  file_format text not null default 'csv' check (file_format in ('csv')),
  encoding text not null check (encoding in ('utf-8', 'shift_jis')),
  source_file_name text,
  sample_count smallint not null check (sample_count between 0 and 5),

  -- 運用メタデータ
  source_system text,
  update_frequency text check (update_frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'irregular', 'none')),
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'published', 'retired')),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_by uuid references public.profiles (id),
  submitted_at timestamptz,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  first_published_at timestamptz,
  retired_by uuid references public.profiles (id),
  retired_at timestamptz,

  -- 機微度の値と組み合わせ
  constraint datasets_sensitivity_values
    check (sensitivity <@ array['public', 'internal', 'confidential', 'personal']::text[]),
  constraint datasets_sensitivity_public_alone
    check (not ('public' = any (sensitivity) and cardinality(sensitivity) > 1)),
  constraint datasets_sensitivity_internal_confidential
    check (not ('internal' = any (sensitivity) and 'confidential' = any (sensitivity))),

  -- 下書き以外では、説明・ドメイン・機微度を必須にする
  constraint datasets_required_after_draft
    check (status = 'draft' or (
      coalesce(btrim(description), '') <> ''
      and domain is not null
      and cardinality(sensitivity) > 0
    )),

  -- 状態ごとに、承認の列が埋まっているかをそろえる
  constraint datasets_approval_by_status
    check (case status
      when 'draft' then submitted_by is null and approved_by is null
      when 'pending_review' then submitted_by is not null and approved_by is null
      else submitted_by is not null and approved_by is not null and approved_at is not null
    end),
  constraint datasets_retired_fields
    check (status <> 'retired' or (retired_by is not null and retired_at is not null)),

  -- 自分の登録・自分の依頼は承認できない
  constraint datasets_no_self_approval
    check (approved_by is null or (approved_by <> created_by and approved_by <> submitted_by))
);

comment on table public.datasets is 'データセット。状態・承認の列はDB関数だけが変える';

create table public.dataset_columns (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.datasets (id) on delete cascade,
  position integer not null check (position >= 1),
  name text not null,
  data_type text not null check (data_type in ('integer', 'decimal', 'date', 'boolean', 'text')),
  null_count integer not null check (null_count >= 0),
  null_rate numeric(5, 4) not null check (null_rate between 0 and 1),
  distinct_count integer not null check (distinct_count >= 0),
  description text,
  sensitivity text check (sensitivity in ('public', 'internal', 'confidential')),
  is_pii boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dataset_id, position),
  unique (dataset_id, name),
  constraint dataset_columns_pii_not_public check (not (is_pii and sensitivity = 'public'))
);

-- 列ごとのサンプル値。RLS で列ごとに出し分けるため、メタデータとは別テーブルにする
create table public.dataset_column_samples (
  column_id uuid primary key references public.dataset_columns (id) on delete cascade,
  sample_values jsonb not null
    check (jsonb_typeof(sample_values) = 'array' and jsonb_array_length(sample_values) <= 5),
  updated_at timestamptz not null default now()
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);

create table public.dataset_tags (
  dataset_id uuid not null references public.datasets (id) on delete cascade,
  tag_id uuid not null references public.tags (id),
  primary key (dataset_id, tag_id)
);

create table public.change_logs (
  id bigint generated always as identity primary key,
  dataset_id uuid not null references public.datasets (id) on delete cascade,
  column_id uuid references public.dataset_columns (id) on delete cascade,
  column_name text,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  note text,
  -- SQLで直接変更したときは空になる
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now()
);

create index change_logs_dataset_idx on public.change_logs (dataset_id, changed_at desc);
create index dataset_columns_dataset_idx on public.dataset_columns (dataset_id);
create index dataset_tags_tag_idx on public.dataset_tags (tag_id);

-- 更新日時を入れる
create function public.set_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger datasets_set_updated_at
  before update on public.datasets
  for each row execute function public.set_updated_at();

create trigger dataset_columns_set_updated_at
  before update on public.dataset_columns
  for each row execute function public.set_updated_at();

create trigger dataset_column_samples_set_updated_at
  before update on public.dataset_column_samples
  for each row execute function public.set_updated_at();

-- 許可していない状態遷移を拒否する
create function public.check_status_transition() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if (old.status, new.status) not in (
    ('draft', 'pending_review'),
    ('pending_review', 'draft'),
    ('pending_review', 'published'),
    ('published', 'draft'),
    ('published', 'retired')
  ) then
    raise exception '状態を「%」から「%」には変えられません', old.status, new.status;
  end if;
  return new;
end;
$$;

create trigger datasets_check_status_transition
  before update of status on public.datasets
  for each row execute function public.check_status_transition();
