-- =====================================================================
-- 開発用DBに溜まった「[テスト]」のデータセットを手作業で消すSQL
--
-- ！！ 本番のプロジェクトでは絶対に実行しないこと ！！
--    実行する前に、Supabase の画面左上のプロジェクト名が「開発用」であることを確かめる
--
-- なぜ手作業か：
--   DBのルール（RLS）では、一度でも公開したデータセットは誰も削除できない（記録を残すため）。
--   DBのテスト（npm run test:db）は公開までの流れを確かめるので、後片付けでは
--   下書きは削除、公開したものは廃止にするしかなく、廃止したものが溜まっていく。
--   SQL Editor は管理者の権限で動き、RLSを通らないので、ここでだけ消せる。
--
-- 対象：名前が「[テスト]」で始まるデータセットだけ（テストはこの名前で作る）。
--   列、サンプル、タグの紐づけ、変更履歴、AI提案は、データセットと一緒に消える（on delete cascade）。
--   タグそのもの（tags）と利用者（profiles）は消さない。
--
-- 使い方：
--   1. 「手順1」だけを選んで実行し、対象の件数と一覧を確かめる
--   2. 「手順2」の EXPECTED_COUNT を、手順1で確かめた件数に書き換える
--   3. 「手順2」だけを選んで実行する。件数が変わっていたら、何も消さずに止まる
-- =====================================================================


-- ---- 手順1：対象を確かめる（読むだけ。何も変えない） ----

-- 状態ごとの件数
select status, count(*) as 件数
from public.datasets
where starts_with(name, '[テスト]')
group by status
order by status;

-- 対象の一覧
select id, name, status, first_published_at, created_at
from public.datasets
where starts_with(name, '[テスト]')
order by created_at;


-- ---- 手順2：消す ----
-- EXPECTED_COUNT（下の 0）を、手順1で確かめた合計の件数に書き換えてから実行する。
-- 件数が合わないとき（新しくテストが走った、など）は、何も消さずにエラーで止まる。

do $$
declare
  expected_count constant integer := 0;  -- EXPECTED_COUNT：手順1の合計の件数に書き換える
  actual_count integer;
  deleted_count integer;
begin
  select count(*) into actual_count
  from public.datasets
  where starts_with(name, '[テスト]');

  if actual_count <> expected_count then
    raise exception '対象が % 件で、確かめた件数（% 件）と違うため止めました。手順1からやり直してください',
      actual_count, expected_count;
  end if;

  delete from public.datasets
  where starts_with(name, '[テスト]');
  get diagnostics deleted_count = row_count;

  raise notice '「[テスト]」のデータセットを % 件削除しました', deleted_count;
end;
$$;
