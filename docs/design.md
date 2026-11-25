# 設計：AIデータカタログ（要件第2版対応／2026/11/9〜29）

要件は [requirements.md](requirements.md)（第2版）を参照。

## 第1版の設計からの主な変更

| 項目 | 第1版 | 第2版 |
|---|---|---|
| 状態 | 下書き → 公開 | 下書き → 承認待ち → 公開 → 廃止 |
| 承認 | スチュワードなら誰でも公開できる | 登録者と承認依頼者は承認できない（DB制約で強制） |
| 分類 | `category`（other あり） | `domain`：顧客・販売・商品・店舗・人事の5つ |
| データセット項目 | 名前、説明、分類、機微度 | データオーナー、担当スチュワード、利用上の注意、出所、更新頻度、ファイル形式、文字コードを追加 |
| 列の項目 | 説明、`is_pii` | 列の機微度、ユニーク数を追加 |
| サンプルの保存 | 行単位（`dataset_sample_rows`） | 列単位（`dataset_column_samples`）。列ごとにRLSで出し分けるため |
| 個人情報を含むデータのサンプル | 閲覧者には全部隠す | 個人情報の列だけ隠し、他の列は見せる |
| 変更履歴 | なし | `change_logs` に項目単位で記録 |
| 削除 | 編集画面から削除 | 一度も公開していない下書きだけ削除できる。公開後は「廃止」 |

## 範囲

- 含む（5.1〜5.5）：ログイン、CSV登録、列情報の自動読み取り、メタデータの手入力、承認の流れ、一覧・詳細・検索、機微度によるサンプルの出し分け（RLS）、変更履歴、サンプルCSV、テスト、Vercelへの公開
- 含む（5.6、6）：AIによるメタデータ提案（[AIによるメタデータ提案](#aiによるメタデータ提案566)）
- 含む（5.7）：質問への回答（[質問への回答](#質問への回答57)）
- 含まない：用語集（5.8）。「[5.7以降のための余地](#57以降のための余地)」のとおり、後から足す

## 方針

- CSVはブラウザ内で読み、原本はサーバーへ送らず保存もしない
- 保存するのは列の情報と、個人情報の列を `***` に伏せたサンプル（最大5件）だけ
- 「誰が何を見られるか」「自分の登録は承認できない」は、画面の表示ではなくDB（RLS、CHECK制約、権限）で守る。画面は同じ判定を使ってボタンや表示を出し分けるだけ
- 状態、承認者などの列はクライアントから直接更新できないようにし、DB関数だけが変える
- CSVの読み取りは `csv-tidy` の `encoding.js` と `csv.js` を流用する（Shift_JIS対応、追加パッケージなし）
- Next.js 16 の Cache Components は使わない。全ページが利用者ごとに（RLSで）内容が変わるため、すべてリクエストごとに描画し、利用者をまたいだキャッシュを起こさない

## 画面

| パス | 画面 | 使える人 | 内容 |
|---|---|---|---|
| `/login` | ログイン | 全員 | メールとパスワードを入力 |
| `/datasets` | 一覧・検索 | ログイン済み | キーワード検索、ドメイン・機微度・状態で絞り込み。閲覧者は公開中だけが出るので、状態の絞り込みはスチュワードだけに表示 |
| `/datasets/[id]` | 詳細 | ログイン済み | 業務・技術・運用メタデータ、列一覧、サンプル（RLSで取れた分だけ）。スチュワードには変更履歴と状態操作のボタン |
| `/datasets/new` | CSV登録 | スチュワード | ファイル選択 → 読み取り結果と個人情報の列の確認 → 下書き作成 |
| `/datasets/[id]/edit` | 編集 | スチュワード（下書きのときだけ） | データセットと列のメタデータ、タグの編集 |
| `/ask` | 質問 | ログイン済み | カタログについての質問に、根拠のデータセットへのリンク付きで答える（5.7） |

- 閲覧者が公開中以外のURLを開くと、RLSで取得できないため 404 になる
- 詳細画面の状態操作ボタン：承認依頼、承認、差し戻し、修正のため下書きに戻す、廃止、削除。押せない人には出さない（承認ボタンは登録者・承認依頼者には出さない）が、最終判定はDB関数が行う
- サンプルは、RLSで取れなかった列を「非表示（機密）」「非表示（個人情報）」と表示する。理由は閲覧者も読める列のメタデータ（機微度、`is_pii`）から決める。取れないことをエラーとして扱わない

## CSV登録の流れ

1. ブラウザでファイルを読み、文字コード（UTF-8／Shift_JIS）の判定とCSVの解析をする
2. 列名、型、件数、列数、欠損数・欠損率、ユニーク数を全行から計算する
3. 個人情報の列の候補を自動で選ぶ
   - 列名：氏名、名前、フリガナ、メール、電話、住所、生年月日、緊急連絡先など
   - 値：全行を見て、メールアドレスや電話番号の形をした値があるか
4. スチュワードが候補と先頭5行のプレビューを確認し、個人情報の列（`is_pii`）を確定する
5. 個人情報の列の値を `***` に置き換えてから、列ごとのサンプル（最大5件）としてサーバーへ送る
6. DB関数 `create_dataset` が、`is_pii` の列のサンプルをもう一度 `***` で上書きしてから保存する（送信側の誤りに備える）

自動で選ぶのは候補だけで、最終判断はスチュワードが行う。備考のような自由記述の列に含まれる個人情報は、列名からは検出できないため、4 のプレビュー確認が前提になる。

業務メタデータ（説明、ドメイン、タグ、オーナー、機微度、列の説明など）は、作成後に編集画面で手入力する。

登録後に個人情報の列を追加するときは、DB関数 `set_column_pii` が `is_pii` の変更とサンプルの置き換えを同時に行う。原本がないので、一度伏せた値は元に戻せない。指定を外しても値は `***` のままで、元の値が必要なら新しいデータセットとして再度アップロードする。

## テーブル

### 全体

```
profiles ─┬─< datasets ─┬─< dataset_columns ──< dataset_column_samples（列ごとに1行）
          │             ├─< dataset_tags >── tags
          │             └─< change_logs
          └─ created_by / submitted_by / approved_by / retired_by / steward_id
```

列名や型の書き方は Postgres のもの。`text + CHECK` で値を絞り、enum型は使わない（後から値を足しやすくするため）。

### profiles（利用者）

| 列 | 型 | 制約・既定 | 説明 |
|---|---|---|---|
| `id` | uuid | PK、→ `auth.users` 連動削除 | |
| `display_name` | text | NOT NULL | 表示名 |
| `role` | text | NOT NULL、既定 `viewer`、`viewer`／`steward` | 役割は1人1つ |

`auth.users` への追加時にトリガーで作る。`role` の変更はSQLで行い、画面からは変えられない。

### datasets（データセット）

| 分類 | 列 | 型 | 制約・既定 | 要件の項目 |
|---|---|---|---|---|
| | `id` | uuid | PK、既定 `gen_random_uuid()` | |
| 業務 | `name` | text | NOT NULL | 名称 |
| 業務 | `description` | text | | 説明 |
| 業務 | `domain` | text | `customer`／`sales`／`product`／`store`／`hr` | データドメイン |
| 業務 | `sensitivity` | text[] | NOT NULL、既定 `'{}'` | 機微度（[機微度](#機微度)） |
| 業務 | `owner_name` | text | | データオーナー（部署名や役職名。ログインする利用者とは限らないので文字列） |
| 業務 | `steward_id` | uuid | → `profiles` | 担当スチュワード |
| 業務 | `usage_notes` | text | | 利用上の注意 |
| 技術 | `row_count` / `column_count` | integer | NOT NULL、0以上 | 件数、列数 |
| 技術 | `file_format` | text | NOT NULL、既定 `csv`、`csv` のみ | ファイル形式 |
| 技術 | `encoding` | text | NOT NULL、`utf-8`／`shift_jis` | 文字コード |
| 技術 | `source_file_name` | text | | アップロード時のファイル名（参考） |
| 技術 | `sample_count` | smallint | NOT NULL、0〜5 | サンプルの件数（全列で同じ） |
| 運用 | `source_system` | text | | 出所（元のシステム名） |
| 運用 | `update_frequency` | text | `daily`／`weekly`／`monthly`／`quarterly`／`yearly`／`irregular`／`none` | 更新頻度 |
| 運用 | `status` | text | NOT NULL、既定 `draft`、`draft`／`pending_review`／`published`／`retired` | 状態 |
| 運用 | `created_by` | uuid | NOT NULL、→ `profiles`（削除不可） | 登録者 |
| 運用 | `created_at` / `updated_at` | timestamptz | NOT NULL、既定 `now()` | 登録日、更新日（カタログ上の日時） |
| 運用 | `submitted_by` / `submitted_at` | uuid / timestamptz | → `profiles` | 承認を依頼した人と日時 |
| 運用 | `approved_by` / `approved_at` | uuid / timestamptz | → `profiles` | 承認者、承認日 |
| 運用 | `first_published_at` | timestamptz | | 初めて公開した日時（削除できるかの判定に使う） |
| 運用 | `retired_by` / `retired_at` | uuid / timestamptz | → `profiles` | 廃止した人と日時 |

CHECK制約（状態ごとの整合と、自分の登録の承認禁止）：

```sql
-- 機微度の値と組み合わせ（詳細は「機微度」）
check (sensitivity <@ array['public','internal','confidential','personal']::text[]),
check (not ('public' = any(sensitivity) and cardinality(sensitivity) > 1)),
check (not ('internal' = any(sensitivity) and 'confidential' = any(sensitivity))),

-- 下書き以外では、説明・ドメイン・機微度を必須にする
check (status = 'draft' or (
  coalesce(btrim(description), '') <> ''
  and domain is not null
  and cardinality(sensitivity) > 0
)),

-- 状態ごとに、承認の列が埋まっているかをそろえる
check (case status
  when 'draft'          then submitted_by is null and approved_by is null
  when 'pending_review' then submitted_by is not null and approved_by is null
  else submitted_by is not null and approved_by is not null and approved_at is not null
end),
check (status <> 'retired' or (retired_by is not null and retired_at is not null)),

-- 自分の登録・自分の依頼は承認できない
check (approved_by is null or (approved_by <> created_by and approved_by <> submitted_by))
```

### dataset_columns（列）

| 分類 | 列 | 型 | 制約・既定 | 要件の項目 |
|---|---|---|---|---|
| | `id` | uuid | PK | |
| | `dataset_id` | uuid | NOT NULL、→ `datasets` 連動削除 | |
| 技術 | `position` | integer | NOT NULL、1以上 | 列の順番 |
| 技術 | `name` | text | NOT NULL | 列名 |
| 技術 | `data_type` | text | NOT NULL、`integer`／`decimal`／`date`／`boolean`／`text` | 型 |
| 技術 | `null_count` | integer | NOT NULL、0以上 | 欠損数 |
| 技術 | `null_rate` | numeric(5,4) | NOT NULL、0〜1 | 欠損率 |
| 技術 | `distinct_count` | integer | NOT NULL、0以上 | ユニーク数 |
| 業務 | `description` | text | | 列の説明 |
| 業務 | `sensitivity` | text | `public`／`internal`／`confidential` | 列の機微度 |
| 業務 | `is_pii` | boolean | NOT NULL、既定 false | 個人情報かどうか |
| | `created_at` / `updated_at` | timestamptz | | |

- UNIQUE(`dataset_id`, `position`)、UNIQUE(`dataset_id`, `name`)（CSVのヘッダーが重複していたら登録前にエラーにする）
- CHECK：`not (is_pii and sensitivity = 'public')`
- 列は登録時に決まり、後から追加・削除しない

### dataset_column_samples（列ごとのサンプル値）

| 列 | 型 | 制約・既定 | 説明 |
|---|---|---|---|
| `column_id` | uuid | PK、→ `dataset_columns` 連動削除 | 1列につき1行 |
| `sample_values` | jsonb | NOT NULL、配列で要素数は5以下 | 先頭5行のその列の値。文字列または null。`is_pii` の列は `***` |
| `updated_at` | timestamptz | | |

- 画面では、全列の `sample_values` を同じ添字で並べてサンプル行に組み立てる。要素数は `datasets.sample_count` と一致させる（`create_dataset` で確認）
- メタデータ（`dataset_columns`）と別テーブルにする理由：RLSは行単位でしか判定できない。列名や説明は公開中なら全員に見せ、サンプルだけを列ごとに隠すには、サンプルを「列ごとに1行」の別テーブルにして、行ごとに見せるかどうかを判定させるのが一番素直なため

### tags（業務用語タグ）、dataset_tags

```
tags
  id uuid PK
  name text NOT NULL UNIQUE
  created_at

dataset_tags
  dataset_id → datasets（連動削除）
  tag_id → tags
  PK(dataset_id, tag_id)
```

### change_logs（変更履歴）

| 列 | 型 | 制約・既定 | 説明 |
|---|---|---|---|
| `id` | bigint | PK、identity | |
| `dataset_id` | uuid | NOT NULL、→ `datasets` 連動削除 | |
| `column_id` | uuid | → `dataset_columns` 連動削除 | 列の変更のとき。データセットの変更は null |
| `field` | text | NOT NULL | どの項目か（下の表） |
| `old_value` / `new_value` | jsonb | | 何から何に。サンプル値は記録しない |
| `note` | text | | 差し戻しや廃止の理由 |
| `changed_by` | uuid | → `profiles` | 誰が（SQL Editor で直接変えたときは空） |
| `changed_at` | timestamptz | NOT NULL、既定 `now()` | いつ |

索引：(`dataset_id`, `changed_at` desc)

| `field` の値 | 記録するとき |
|---|---|
| `created` | 登録したとき（値は持たない） |
| `name`、`description`、`domain`、`sensitivity`、`owner_name`、`steward_id`、`usage_notes`、`source_system`、`update_frequency` | データセットの項目を変えたとき |
| `status` | 状態を変えたとき（承認、差し戻しなども含む。理由は `note`） |
| `tags` | タグを変えたとき（変更前後のタグ名の配列） |
| `column.description`、`column.sensitivity`、`column.is_pii` | 列の項目を変えたとき |
| `column.sample_masked` | サンプルを `***` に伏せたとき。**伏せる前の値は記録しない**（記録すると個人情報が履歴に残るため） |

## 機微度

### データセットの機微度

要件の4区分を、複数選べる形（`text[]`）にする。

| 組み合わせ | 可否 | 例 |
|---|---|---|
| `public` だけ | 可 | 商品 |
| `public` と他の値 | 不可 | |
| `internal` と `confidential` | 不可 | |
| `personal` だけ、または `internal`／`confidential` との組み合わせ | 可 | 顧客＝`personal`、従業員＝`personal`＋`confidential` |

### 列の機微度と個人情報

- 列の機微度は `public`／`internal`／`confidential` から1つ。「個人情報を含む」は列では `is_pii` で表す（要件4.2の「機微度」と「個人情報かどうか」をそのまま2つの列にする）
- `is_pii` は「個人に結びつく値で、サンプルでは伏せる列」。氏名、連絡先、住所、生年月日のほか、従業員の月給や人事評価も含む

### データセットと列の整合

承認依頼（`submit_for_review`）と承認（`approve_dataset`）のときに、DB関数で確認する。下書きの間は途中の状態を許す。

| 条件 | 理由 |
|---|---|
| 全列で `sensitivity` が入っている | 列の機微度の付け漏れを防ぐ |
| `is_pii` の列がある ⇔ データセットに `personal` がある | 個人情報の有無をデータセット単位で検索・絞り込みできるようにする |
| `confidential` の列がある ⇒ データセットに `confidential` がある | 列が機密なら、サンプルをデータセット全体で隠す扱いにする |
| `internal` の列がある ⇒ データセットは `public` ではない | 公開データに社内の列が混ざらないようにする |
| 担当スチュワード（`steward_id`）が選ばれていて、その `role` が `steward` | 担当者のいないデータセットを公開しない |

## 承認の流れ

### 状態遷移

```
            submit_for_review               approve_dataset
  draft ─────────────────────▶ pending_review ─────────────▶ published ──▶ retired
    ▲                               │                           │  retire_dataset
    └──── return_to_draft ──────────┘                           │
    ▲     （差し戻し・取り下げ）                                  │
    └──── return_to_draft（修正のため下書きに戻す）──────────────┘
```

| 操作 | DB関数 | できる人 | 前の状態 → 後の状態 | 変わる列 |
|---|---|---|---|---|
| 承認依頼 | `submit_for_review(id)` | スチュワード | draft → pending_review | `submitted_by`=自分、`submitted_at` |
| 承認 | `approve_dataset(id)` | スチュワード（登録者・依頼者以外） | pending_review → published | `approved_by`=自分、`approved_at`、初回なら `first_published_at` |
| 差し戻し・取り下げ | `return_to_draft(id, reason)` | スチュワード | pending_review → draft | `submitted_*`、`approved_*` を空に |
| 修正のため下書きに戻す | `return_to_draft(id, reason)` | スチュワード | published → draft | 同上。閲覧者からは見えなくなる |
| 廃止 | `retire_dataset(id, reason)` | スチュワード | published → retired | `retired_by`、`retired_at` |
| 削除 | `DELETE`（RLS） | スチュワード | draft かつ `first_published_at` が空のときだけ | 行ごと削除（列、サンプル、履歴も連動削除） |

- 廃止は戻せない。再び使うときは新しく登録する
- 公開中のデータセットを直すときは、いったん下書きに戻して、もう一度承認を通す（版を分けて公開したまま直す仕組みは今週は作らない）
- 状態遷移は、上の表以外を `BEFORE UPDATE` トリガーでも拒否する

### 「自分の登録は承認できない」の守り方

3か所で守る。画面の表示は補助で、外しても1〜3で止まる。

1. **列の更新権限**：`status`、`created_by`、`submitted_*`、`approved_*`、`retired_*`、`first_published_at` には `authenticated` の UPDATE 権限を付けない。クライアントから `update datasets set status='published', approved_by=…` を送っても権限エラーになる
2. **DB関数**：`approve_dataset` は `approved_by` に引数ではなく `auth.uid()` を入れ、`auth.uid()` が `created_by` または `submitted_by` と同じならエラー「自分が登録または承認依頼したデータセットは承認できません」を返す
3. **CHECK制約**：`approved_by <> created_by and approved_by <> submitted_by`。関数に誤りがあっても、この組み合わせの行は保存できない

`created_by` は `create_dataset` が `auth.uid()` を入れ、`datasets` への直接の INSERT 権限は付けないので、登録者をなりすますこともできない。

承認依頼者も承認できないことにしている（要件より一段厳しい）。下書きを他の人が直して依頼し、元の登録者でも依頼者でもない人が承認する形になる。

### 承認待ちの間は編集できない

`datasets`、`dataset_columns` の UPDATE ポリシーは「スチュワード かつ 親が `draft`」。承認待ちになった後に内容を書き換えて、確認していない内容が公開されることを防ぐ。

例外は `set_column_pii`（個人情報の列の追加）で、守りを強める操作なのでどの状態でもできる。公開中・承認待ちのデータセットで実行したときは、整合の条件が崩れるので自動で下書きに戻す。

## サンプル値の出し分け（RLS）

### 判定

| 見る人 | データセット | 列 | サンプル |
|---|---|---|---|
| スチュワード | すべての状態 | すべて | 見える（`is_pii` の列は保存時に伏せた `***`） |
| 閲覧者 | 公開中以外 | | 見えない（データセットごと見えない） |
| 閲覧者 | 公開中で `confidential` を含む | すべて | 見えない（データセット全体で隠す） |
| 閲覧者 | 公開中で `confidential` を含まない | `is_pii` または列が `confidential` | 見えない（その列だけ隠す） |
| 閲覧者 | 公開中で `confidential` を含まない | 上以外 | 見える |

例：顧客（`personal`）は、閲覧者には顧客ID、居住地域、会員ランクなどのサンプルは見え、氏名・メール・電話番号・生年月日の列だけ見えない。従業員（`personal`＋`confidential`）は全列見えない。

`is_pii` の列は「保存時に伏せる」と「閲覧者にはRLSで返さない」の二重になる。前者は保存するデータとAIに送るデータ（5.6）を守るため、後者は要件5.3をDBで強制するため。

### ポリシー

```sql
-- RLSから使う権限判定。profiles のRLSに左右されないよう security definer にする
create function public.is_steward() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'steward'
  );
$$;

alter table public.dataset_column_samples enable row level security;

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
      and not ('confidential' = any(d.sensitivity))
      and c.sensitivity is distinct from 'confidential'
      and not c.is_pii
  )
);
-- INSERT／UPDATE／DELETE のポリシーと権限は作らない（DB関数だけが書く）
```

列の `confidential` の判定は、整合の条件があれば不要だが、条件の確認漏れに備えて重ねておく。

## 権限とRLSの一覧

Supabase は既定で `anon` と `authenticated` に全権限を付けるため、マイグレーションで `revoke all ... from anon, authenticated` してから、必要な分だけ付ける。`anon` には何も付けない。

| テーブル | 読み取り（RLS） | 書き込み権限 | 書き込み（RLS） |
|---|---|---|---|
| `profiles` | ログイン済み全員 | なし | |
| `datasets` | `status='published'` またはスチュワード | UPDATE は業務・運用の手入力の列（`name`、`description`、`domain`、`sensitivity`、`owner_name`、`steward_id`、`usage_notes`、`source_system`、`update_frequency`）だけ。DELETE | UPDATE：スチュワード かつ `draft`。DELETE：スチュワード かつ `draft` かつ `first_published_at` が空 |
| `dataset_columns` | 親データセットを読める人 | UPDATE は `description`、`sensitivity` だけ | スチュワード かつ 親が `draft` |
| `dataset_column_samples` | 上の「ポリシー」 | なし | |
| `tags` | ログイン済み全員 | INSERT | スチュワード |
| `dataset_tags` | 親データセットを読める人 | なし（`set_dataset_tags` で変える） | |
| `change_logs` | スチュワード | なし（トリガーと関数だけが書く） | |

`dataset_columns`、`dataset_tags` の「親データセットを読める人」は、`exists (select 1 from datasets d where d.id = dataset_id)` で書く。サブクエリにも `datasets` のRLSがかかるので、条件を二重に書かずに済む。

## DB関数

`security definer` の関数は `set search_path = ''` を付け、`public`／`anon` から実行権限を外して `authenticated` にだけ付ける。中で必ず `is_steward()` を確認する。

| 関数 | 種類 | 内容 |
|---|---|---|
| `is_steward()` | definer | 権限判定 |
| `create_dataset(payload jsonb) → uuid` | definer | データセット、列、サンプルを1つのトランザクションで登録する。`created_by` は `auth.uid()`、状態は `draft`。サンプルの件数がすべての列で同じか、5件以下かを確認し、`is_pii` の列を `***` で上書きする |
| `set_column_pii(column_id, is_pii)` | definer | `is_pii` の変更とサンプルの置き換えを同時に行う。`true` にするとサンプルを `***` にする。`false` にできるのは下書きだけ。公開中・承認待ちなら下書きに戻す |
| `set_dataset_tags(dataset_id, names text[])` | definer | タグを差し替える。無いタグは作る。下書きだけ |
| `submit_for_review(id)` | definer | 整合の条件を確認して承認待ちにする |
| `approve_dataset(id)` | definer | 登録者・依頼者でないこと、整合の条件をもう一度確認して公開する |
| `return_to_draft(id, reason)` | definer | 承認待ち・公開中から下書きに戻す。理由は必須 |
| `retire_dataset(id, reason)` | definer | 公開中を廃止にする。理由は必須 |
| `search_datasets(...)` | **invoker** | 検索（下記）。RLSをそのまま効かせるため definer にしない |

エラーメッセージは日本語にする（例：「承認待ちのデータセットだけが承認できます」）。

## 変更履歴の記録

- `datasets` と `dataset_columns` に `AFTER UPDATE` トリガー（definer）を付け、`change_logs` の `field` の表にある列を `IS DISTINCT FROM` で比べ、変わった項目ごとに1行書く。`changed_by` は `auth.uid()`
- 差し戻しや廃止の理由は、関数が `set_config('app.change_note', reason, true)`（そのトランザクションだけ有効）で渡し、トリガーが `note` に入れる
- `created`、`tags`、`column.sample_masked` は、それぞれ `create_dataset`、`set_dataset_tags`、`set_column_pii` が書く
- 詳細画面では、スチュワードにだけ新しい順で表示する

## 検索

```
search_datasets(
  q text default null,               -- 名称・説明・タグ・列名へのキーワード
  domains text[] default null,       -- いずれかに一致
  sensitivities text[] default null, -- いずれかを含む（&&）
  statuses text[] default null       -- 閲覧者はRLSで公開中しか返らない
) returns setof datasets
language sql stable security invoker
```

- キーワードは `ILIKE` で、`%` と `_` はエスケープする。50件程度なので全文検索や trigram の索引は使わない
- 閲覧者が `statuses` に `draft` を指定しても、RLSで公開中しか返らない

## AIによるメタデータ提案（5.6、6）

### 方針

- AIに送るデータは、DBに保存済みの列情報と伏せたサンプルから、送ってよい項目だけを書き出して作る（許可リスト）。送る直前にもう一度伏せる
- 提案は `ai_suggestions` に項目ごとに保存する。データセット本体とは別のテーブルなので、採用されるまで本体の項目には入らない。採用した後も、公開には従来どおり承認が要る
- 判断（採用・修正・却下）はDB関数だけが行い、値の反映と変更履歴の記録を1つのトランザクションで行う
- AIの呼び出しは `MetadataSuggester` の裏に隠す。本番は Claude（`@anthropic-ai/sdk`）、テストと動作確認は決まった提案を返す偽物

### AIに送るデータ（要件6）

`src/lib/ai/build-input.ts` が作る。

| 送る | 送らない |
|---|---|
| データセット名、件数、列数、列ごとの列名・型・欠損率・ユニーク数・サンプル値（最大5件） | 説明、ドメイン、タグ、機微度、オーナー、担当スチュワード、利用上の注意、出所、ファイル名、列の説明 |

- `is_pii` の列のサンプルは、保存時に伏せてあっても `***` にし直す
- 列を問わず、メールアドレス・電話番号の形の値（`src/lib/csv/detect-pii.ts` の判定）は `***` にする
- データセット名は送るので、登録画面と編集画面の名称欄に「機密情報（顧客名・個人名・取引先名など）を含めないでください」と表示する
- サンプル値に指示のような文があっても従わないよう、システムプロンプトに書く

### 呼び出しと構造化出力

| 項目 | 値 |
|---|---|
| モデル | `claude-opus-5-5`、`output_config.effort: "medium"`、`max_tokens: 16000` |
| 出力 | `output_config.format` に JSON Schema（`src/lib/ai/suggestion-schema.ts`）。Zod は使わない |
| 断られたとき | サーバー側のフォールバック（beta `server-side-fallback-2026-07-01`、`fallbacks: "default"`）。それでも `refusal`、または `max_tokens` で切れたら日本語のエラー |
| プロンプトの版 | `src/lib/ai/prompt.ts` の `PROMPT_VERSION`。変えたら上げる（採用率を版ごとに比べる） |

返答の形：

```json
{
  "dataset": { "description": "…", "domain": "customer", "tags": ["…"], "sensitivity": ["personal"], "reason": "…" },
  "columns": [{ "name": "氏名", "description": "…", "sensitivity": "internal", "is_pii": true, "reason": "…" }]
}
```

`src/lib/ai/validate-output.ts` で、列名が送った列と1対1か、値が選択肢の中か、機微度の組み合わせ、個人情報の列を「公開」にしていないか、文字数・タグ数を確かめる。1つでも外れたら保存しない。

### テーブル

**ai_suggestion_runs**（AIを1回呼ぶごとに1行）：`dataset_id`、`model`、`prompt_version`、`input_tokens`、`output_tokens`、`requested_by`、`created_at`

**ai_suggestions**（項目ごとに1行）

| 列 | 説明 |
|---|---|
| `run_id`、`dataset_id`、`column_id`、`column_name` | 列の項目のときだけ `column_id` が入る |
| `field` | `change_logs.field` と同じ名前：`description`／`domain`／`tags`／`sensitivity`／`column.description`／`column.sensitivity`／`column.is_pii` |
| `suggested_value` jsonb、`reason` | 提案値と根拠 |
| `decision` | `pending`（未判断）／`accepted`（採用）／`modified`（修正して採用）／`rejected`（却下）／`superseded`（提案させ直して置き換えた） |
| `final_value` jsonb | 確定値。採用なら提案値と同じ、却下なら空 |
| `decided_by`、`decided_at`、`decided_in_bulk` | 判断した人・日時、まとめて判断したか |

- CHECK制約で、判断の結果ごとに確定値と判断者をそろえる
- RLS：読めるのはスチュワードだけ。書き込み権限は付けず、DB関数だけが書く

**change_logs** に `suggestion_id`、`suggested_value`、`ai_decision` を足し、提案値と確定値（`new_value`）を1行で追えるようにする。

### DB関数

| 関数 | 内容 |
|---|---|
| `save_ai_suggestions(dataset_id, model, prompt_version, usage, items)` | 下書きだけ。前回の未判断の提案を `superseded` にし、実行記録と提案を保存する。履歴に `ai_suggested`（件数・モデル・版）を1行 |
| `decide_ai_suggestion(id, decision, final)` | 下書き・未判断の提案だけ。採用・修正なら値を反映する（タグは `set_dataset_tags`、個人情報は `set_column_pii` を通す）。修正した値が提案と同じ（空白や並び順の違いだけ）なら `accepted` にそろえる |
| `decide_ai_suggestions_bulk(dataset_id, decision)` | 未判断の提案をまとめて採用または却下する。中で1件ずつ同じ処理を呼ぶので、提案ごとに判断結果と履歴が残る（`decided_in_bulk`、履歴の `note` は「まとめて採用」「まとめて却下」）。1件でも反映できなければ全部取り消す |
| `submit_for_review(id)` | 未判断の提案が残っていたらエラー「未判断のAI提案があります」 |

変更履歴への記録：

- 判断中の提案IDを `set_config('app.suggestion_id', id, true)` で渡し、既存の変更履歴トリガー（と `set_dataset_tags`）が、項目と列が一致する行に `suggestion_id`・`suggested_value`・`ai_decision` を付ける
- 却下や、今と同じ値の採用ではトリガーが動かないので、関数が自分で1行書く（変更前＝変更後＝今の値）
- まとめて採用するとき、列の「個人情報」と「機微度」は、途中で CHECK（個人情報の列は公開にできない）を破らない順に反映する

### 採用率

ビュー `ai_suggestion_stats`（`security_invoker`）が、項目×モデル×プロンプトの版ごとに採用・修正・却下・まとめて判断の件数を数える。未判断と置き換え済みは数えない。

- 採用率 ＝ 採用 ÷ 判断済み
- 修正込み採用率 ＝（採用 ＋ 修正して採用）÷ 判断済み

画面 `/ai-stats`（スチュワードだけ）に、全体・版別・項目別で出す。まとめて採用した分は採用に含め、件数を別に出す。

### 画面

- 編集画面の上部に「AI提案」の枠。「AIに提案させる」、項目ごとの「採用」「修正して採用」「却下」、「まとめて採用」「まとめて却下」（確認ダイアログ付き）
- 変更履歴の「AI提案・理由」欄に「AI提案：◯◯ → 採用」のように出す

### テスト

- 単体（`tests/unit/ai.test.ts`）：送るデータの項目と伏せ直し、返答の確認、項目ごとの行への分解、偽物の suggester、Claude の suggester（偽のクライアントを渡し、送ったリクエストとエラーを確認）、修正値の読み取り、採用率。本物のAPIは呼ばない
- DB（`tests/db/ai.test.ts`）：閲覧者は提案を作れない・読めない・判断できない、採用・修正・却下の値と履歴、まとめて採用・却下の履歴、未判断があると承認依頼できない、再提案で置き換え、存在しない列の提案

### 5.7以降のための余地

| 機能 | 後から足すもの | 今の設計で備えている点 |
|---|---|---|
| 5.7 質問への回答（RAG） | キーワード検索で実装した（[質問への回答](#質問への回答57)）。ベクトル検索にするときは `dataset_embeddings`（`dataset_id`、`content`、`embedding vector`）を足す。Supabase の pgvector 拡張を使う | 「探す」部分は `DatasetRetriever` の裏に隠してあるので、差し替えは組み立てる場所の1行で済む。埋め込みテーブルにも `datasets` と同じRLSを付け、検索関数は invoker にする |
| 5.8 用語集 | `glossary_terms`（`term`、`definition`）と `tags.glossary_term_id`（null可） | タグを独立したテーブルにしてあるので、後から用語と結びつけられる |

## 質問への回答（5.7）

### 方針

- 「探す」と「答える」を分ける。まず既存の `search_datasets` で関係するデータセットを探し、その結果だけを Claude に渡して答えさせる
- 探す処理はログイン中の利用者のセッションで行い、RLSを効かせる。根拠は役割に関係なく公開中だけ（`p_statuses = ['published']` を明示し、閲覧者はRLSでも公開中しか返らない）
- サンプル値は利用者のセッションで読む。RLSで隠れたものは返らないので、隠しているサンプル値はAIに渡らない。さらに送る直前に伏せ直す
- 根拠のリンクは Claude に書かせない。Claude が返したIDのうち、検索結果に含まれるものだけからアプリが `/datasets/{id}` のリンクを作る
- 「探す」部分（`DatasetRetriever`）は差し替えられる作りにし、後でベクトル検索に替えられるようにする
- 質問と回答はDBに保存しない
- 新しいテーブル、DB関数、マイグレーション、npmパッケージは足さない

### 処理の流れ

```
質問
 └─ ① QueryPlanner（Claude 1回目）：質問 → { keywords[1〜5], domains[] }
 └─ ② KeywordRetriever：キーワードごとに search_datasets を呼び、結果を合わせる
       （利用者のセッション → RLS）。当たったキーワードの数で並べ、上位8件にする
       └─ 0件 → Claude を呼ばずに coverage = none を返す
 └─ ③ 根拠データの組み立て：名称・説明・ドメイン・タグ・機微度・利用上の注意・
       列（名前・型・説明）・サンプル値（RLSで読めた分だけ、さらに伏せ直す）
 └─ ④ Answerer（Claude 2回目、構造化出力）→ 下の「返答の形」
 └─ ⑤ 返答の検証（下記）
 └─ 画面：回答文、足りないデータ（partial のとき）、根拠ごとのリンク
```

キーワードを先に取り出すのは、今の検索が1つの文字列での部分一致（ILIKE）だから。「会員ランク別の売上を分析したい」という文のままでは何にも当たらない。日本語は単語の区切りがないので、自前で分割するより、Claude に「売上」「会員ランク」のような言葉と、言い換え（「客単価」→「売上金額」など）を出させる。

### 差し替えできる作り

```ts
// src/lib/qa/retriever.ts
export type RetrievedDataset = {
  id: string; name: string; description: string | null; domain: Domain | null;
  sensitivity: Sensitivity[]; tags: string[]; usage_notes: string | null;
  columns: { name: string; data_type: DataType; description: string | null; samples: (string | null)[] }[];
  score: number; // 並べ替え用。キーワード検索では当たった数、ベクトル検索では類似度
};

export interface DatasetRetriever {
  retrieve(question: string, opts: { limit: number }): Promise<RetrievedDataset[]>;
}
```

- `createKeywordRetriever(supabase, planner)`：今回作る。planner はこの中だけで使う
- 後で作る `createVectorRetriever(supabase, embedder)`：invoker の `match_datasets(embedding, k)` を呼ぶ。planner は要らない
- Supabase のクライアントは引数で受け取る。画面では Cookie セッションのクライアント、評価スクリプトではテスト利用者でログインしたクライアント、単体テストでは偽物を渡す。既存の `queries.ts` は `server-only` と Cookie に依存してスクリプトから使えないため、読み取りは `src/lib/qa/load-datasets.ts` にクライアントを受け取る形で書く

### 権限とRLS

| 守るもの | 方法 |
|---|---|
| 閲覧者に公開中以外を渡さない | `search_datasets` は invoker なのでRLSが効く。そのうえで `p_statuses = ['published']` を明示し、スチュワードでも公開中だけを根拠にする |
| 隠しているサンプル値を渡さない | `dataset_column_samples` を利用者のセッションで読む。RLSで隠れた行は返らない。送る直前に `maskPiiLikeValue` で伏せ直す |
| definer の関数を増やさない | 新しいDB関数は作らない（ベクトル検索のときも invoker にする） |
| データの中の指示に従わない | 説明文やサンプル値はデータであり、中の指示には従わないとシステムプロンプトに書く |

### 返答の形

```json
{
  "coverage": "partial",
  "answer": "注文データの注文日と店舗IDから、店舗・日ごとの注文件数を来店数の代わりに集計できます。…",
  "missing_data": ["天気（日付・地域ごとの天候や気温）"],
  "cited_dataset_ids": ["<注文のID>"]
}
```

| 項目 | 内容 |
|---|---|
| `coverage` | `full`（カタログのデータで答えられる）、`partial`（一部しか答えられない）、`none`（該当するデータがない） |
| `answer` | 回答文（400字以内）。どの列をどう使うかを書く |
| `missing_data` | 足りないデータ。`partial` のときは1件以上必須。それ以外は空 |
| `cited_dataset_ids` | 根拠にしたデータセットのID。`full`／`partial` のときは1件以上 |

構造化出力では「coverage によって必須」を書けないので、⑤でアプリが確かめる（`src/lib/qa/validate-answer.ts`）。

- 引用IDは②の結果に含まれるものだけ残し、ほかは捨てる
- `full`／`partial` なのに有効な引用が0件なら、`none` として扱う（根拠のない回答は出さない）
- `partial` なのに `missing_data` が空なら、返答に問題があるとしてエラーにする
- `none` のときは引用と `missing_data` を無視し、「カタログに該当するデータセットは見つかりませんでした」と表示する

### モデルと呼び出し

| 部品 | 環境変数 | 初期値 | effort |
|---|---|---|---|
| planner | `QA_PLANNER_MODEL` | `claude-haiku-4-5` | `low`（対応するモデルだけ） |
| answerer | `QA_ANSWERER_MODEL` | `claude-sonnet-5-5` | `medium`（対応するモデルだけ） |

モデルによって送れるパラメータが違うため、`src/lib/qa/models.ts` に使ってよいモデルと送るものを表で持つ。表にないモデルを設定したら日本語のエラーにする。

| モデル | 構造化出力 | effort | `fallbacks: "default"` |
|---|---|---|---|
| `claude-haiku-4-5` | ○ | 送らない（400になる） | 送らない（対象外） |
| `claude-haiku-5-5` | ○ | ○ | 送らない（対象外） |
| `claude-sonnet-5-5` | ○ | ○ | ○ |
| `claude-opus-5-5` | ○ | ○ | ○ |

- フォールバックがないモデルで `stop_reason: "refusal"` になったら「AIが回答を断りました」と表示する
- トークン数は、`usage.iterations` があればその合計を使う（フォールバックが起きたとき、断られた側の分も数えるため）
- 1回の質問の目安：Claude を2回呼び、入力3〜6千、出力1〜2千トークン（根拠は最大8件）
- APIを呼ばずに画面を確かめるときは、5.6と同じ `AI_SUGGESTER=fake` で planner と answerer も偽物にする

### 評価

`eval/qa-cases.json` に質問と正解の組を14問持つ。正解はIDではなくデータセットの名称で持つ（IDは環境ごとに変わるため）。開発用DBで、サンプルCSVの5つのデータセット（顧客・従業員・注文・商品・店舗）が公開中になっていることを前提にする。この状態は `npm run seed:dev`（`scripts/seed-dev-datasets.ts`）で作る。2人のテスト用スチュワードで、登録・入力・承認依頼・承認を普通の手順で行う（RLSと承認のルールを通る）。何度実行してもよく、公開中のものには触らない。説明やタグ（`scripts/dev-datasets.ts`）は現場で書かれそうな程度にとどめ、質問の言葉をわざと入れない正解は役割に関係なく同じ。

| # | 質問 | 正解 | coverage | 使う列（サンプルCSVで確認済み） |
|---|---|---|---|---|
| 1 | 会員ランク別の売上を分析したい | 顧客, 注文 | full | 顧客.会員ランク・顧客ID／注文.顧客ID・売上金額 |
| 2 | 店舗ごとの粗利を比べたい | 注文, 店舗 | full | 注文.店舗ID・粗利額／店舗.店舗ID・店舗名。粗利は注文の `粗利額` を店舗IDで合計すれば出る。原価の列はないが、粗利額があるので完全に答えられる（原価は `売上金額 − 粗利額` で逆算もできる） |
| 3 | 商品カテゴリ別の販売数量の推移を見たい | 注文, 商品 | full | 注文.注文日・商品ID・数量／商品.商品ID・カテゴリ |
| 4 | 地域別の顧客数を知りたい | 顧客 | full | 顧客.居住地域 |
| 5 | 店舗の売場面積と売上の関係を見たい | 店舗, 注文 | full | 店舗.店舗ID・売場面積／注文.店舗ID・売上金額 |
| 6 | 退会した顧客の傾向を調べたい | 顧客 | full | 顧客.退会日・会員ランク・居住地域・登録日 |
| 7 | 支払方法の割合を知りたい | 注文 | full | 注文.支払方法 |
| 8 | 販売終了した商品の一覧がほしい | 商品 | full | 商品.商品名・販売終了日 |
| 9 | 店舗の人員配置と給与を分析したい | 従業員, 店舗 | full | 従業員.所属店舗ID・役職・給与／店舗.店舗ID・従業員数 |
| 10 | 仕入先ごとの納品リードタイムを調べたい | なし | none | 仕入先・納品日の列はどのデータセットにもない |
| 11 | 客単価を出したい | 注文 | full | 注文.注文ID・売上金額（言い換え：1注文あたりの売上） |
| 12 | リピーターの割合を知りたい | 注文 | full | 注文.顧客ID・注文日（言い換え：2回以上購入した顧客） |
| 13 | 店舗別の人件費を出したい | 従業員 | full | 従業員.所属店舗ID・給与（言い換え：人件費＝給与） |
| 14 | 天気と来店数の関係を調べたい | 注文 | partial | 注文.注文日・店舗ID（来店数の代わりに注文件数）。天気のデータがない |

- 11〜13 は、正解のデータセットの名称・説明・列名に質問の言葉（客単価、リピーター、人件費）が出てこない問題。planner が言い換えられるか、つまり「探す」部分の力を確かめる。ベクトル検索と比べるときに差が出やすい
- 9 の従業員は公開中なので、閲覧者にも名称・説明・列名は見える（RLSで隠れるのはサンプル値だけ）。そのため正解は役割に関係なく同じ
- 14 の `expected_missing_keywords: ["天気"]` は、`missing_data` のどれかにその言葉が含まれるかで確かめる
- 問題の中の呼び名と開発用DBでの名称の対応は、`eval/qa-cases.json` の `datasets` に持つ。今は同じ名称（顧客など）。名称を変えた場合はここを合わせる

指標（`src/lib/qa/evaluate.ts`。純粋関数にして単体テストする）：

| 指標 | 内容 |
|---|---|
| coverage の正解率 | 返した `coverage`（full／partial／none）が正解と一致した割合。3×3 の混同行列も出す |
| 検索の再現率 | 正解のデータセットのうち、②の検索結果に入った割合（正解が「なし」の問題は除く）。「探す」部分の性能 |
| 引用の再現率・適合率 | 回答が引用したデータセットと正解を比べる |
| 足りないデータの一致 | `partial` の問題で、`expected_missing_keywords` が `missing_data` に含まれた割合 |

実行は `scripts/eval-qa.ts` を手で行う。本物のAPIを呼ぶので `npm test` には含めない。

```
node --env-file=.env.local scripts/eval-qa.ts \
  --planner claude-haiku-4-5,claude-haiku-5-5 \
  --answerer claude-sonnet-5-5,claude-opus-5-5
```

- planner と answerer の組み合わせごとに、全問を閲覧者とスチュワードの両方で実行し、組み合わせごとの指標とモデル別のトークン数を表にする。役割で結果が違えば、RLSか根拠の組み立てを疑う
- 実行前に呼び出し回数の見込み（組み合わせ数 × 問題数 × 2役割 × 最大2回）を表示し、確認してから進む
- 結果は `eval/results/<日時>.json` に保存する（gitには含めない）

### 画面

| パス | 画面 | 使える人 | 内容 |
|---|---|---|---|
| `/ask` | 質問 | ログイン済み | 質問を入力し、回答文、足りないデータ（partial のとき）、根拠のデータセットへのリンクを表示する |

### テスト

本物のAPIは呼ばない。

- 単体（`tests/unit/qa.test.ts`）：偽の planner・answerer・Supabase クライアントを使う。キーワードごとの結果の合わせ方と並べ方、上位件数での打ち切り、0件のとき answerer を呼ばないこと、根拠データの項目と伏せ直し、範囲外の引用を捨てること、coverage ごとの検証（引用0件の full を none に、`missing_data` が空の partial をエラーに）、モデルごとのリクエストの形（Haiku 4.5 に effort と fallbacks を送らない）、評価の指標の計算
- DB（`tests/db/qa.test.ts`）：Retriever を閲覧者で動かし、下書きが返らないこと、機密のデータセットのサンプルが空であること、個人情報の列のサンプルが空であることを確かめる

## ログイン

- Supabase Auth のメールアドレスとパスワードを、`@supabase/ssr` のCookieセッションで使う
- 新規登録は無効にし、利用者はSupabaseの管理画面で作成する
- 権限は閲覧者（`viewer`）とスチュワード（`steward`）の2種類
- 確認は3か所：`proxy.ts`（セッション更新、未ログインの移動）、保護レイアウト（サーバー側でログイン確認）、Server Action（処理ごとの権限確認）。最終的にはRLS、権限、CHECK制約で守る

## フォルダ構成

```
src/
  proxy.ts                    セッション更新、未ログインの移動
  app/
    layout.tsx, not-found.tsx
    page.tsx                  /datasets へ移動
    login/                    page.tsx, login-form.tsx, actions.ts（ログイン、ログアウト）
    (protected)/              ログイン必須の範囲
      layout.tsx, error.tsx
      datasets/
        page.tsx              一覧・検索
        actions.ts            作成・更新・状態の変更・削除
        ai-actions.ts         AI提案の作成と判断（採用・修正・却下、まとめて）
        new/                  page.tsx, upload-form.tsx
        [id]/                 page.tsx（詳細）と、メタデータ・列・サンプル・変更履歴・状態操作の部品
        [id]/edit/            page.tsx, edit-form.tsx, ai-suggestion-panel.tsx（AI提案）
      ai-stats/               page.tsx（AI提案の採用率。スチュワードだけ）
      ask/                    page.tsx, ask-form.tsx, actions.ts（質問への回答）
  components/                 共通UI（バッジ、フォーム部品、表示の整形）
  lib/
    csv/                      decode.ts, parse.ts, profile.ts（統計値）, detect-pii.ts, mask.ts, analyze.ts（まとめて読み取る）
    datasets/                 queries.ts, validation.ts, status.ts（状態と操作の可否）, samples.ts（列ごとのサンプルを行に組み立てる）,
                              payload.ts（create_dataset に渡す内容）, search-params.ts, labels.ts, change-log-format.ts
    ai/                       build-input.ts（送るデータ）, prompt.ts, suggestion-schema.ts, validate-output.ts,
                              to-rows.ts, suggester.ts, claude-suggester.ts, fake-suggester.ts, parse-final.ts, adoption.ts
    qa/                       retriever.ts, keyword-retriever.ts, load-datasets.ts, query-planner.ts, build-context.ts,
                              models.ts, prompt.ts, answer-schema.ts, claude-answerer.ts, fake-answerer.ts,
                              validate-answer.ts, ask.ts（①〜⑤をつなぐ）, evaluate.ts（評価の指標）
    auth/                     require-user.ts, require-steward.ts
    supabase/                 env.ts, server.ts, proxy-session.ts, errors.ts（DBのエラーを日本語にする）
  types/database.ts
supabase/migrations/          テーブル、権限、RLS、トリガー、DB関数
scripts/generate-samples.mjs  サンプルCSVの生成
scripts/eval-qa.ts            質問への回答の評価（本物のAPIを呼ぶ。手で実行）
eval/qa-cases.json            評価の質問と正解
samples/                      生成したCSV
tests/unit/                   単体テスト（node --test）
tests/db/                     DBのテスト（開発用プロジェクトに接続）
```

## サンプルCSV

架空の会社「サンプルリテール株式会社」のデータを `scripts/generate-samples.mjs` で生成する。乱数のシードを固定し、何度実行しても同じCSVができるようにする。追加パッケージは使わない。列は要件3の「主な列」を含むようにする。

| ファイル | 行数 | 列 | データセットの機微度 | `is_pii` の列 | `confidential` の列 |
|---|---|---|---|---|---|
| `products.csv` | 100 | 商品ID、商品名、カテゴリ、価格、発売日、販売終了日 | 公開 | なし | なし |
| `stores.csv` | 20 | 店舗ID、店舗名、地域、都道府県、業態、開店日、売場面積、従業員数、改装予定日 | 社内 | なし | なし |
| `orders.csv` | 3000 | 注文ID、注文日、顧客ID、店舗ID、商品ID、数量、単価、割引額、売上金額、粗利額、支払方法 | 機密 | なし | 売上金額、粗利額 |
| `customers.csv` | 500 | 顧客ID、氏名、フリガナ、メール、電話番号、生年月日、居住地域、会員ランク、登録日、退会日 | 個人情報を含む | 氏名、フリガナ、メール、電話番号、生年月日 | なし |
| `employees.csv` | 50 | 従業員ID、氏名、フリガナ、メール、電話番号、住所、生年月日、入社日、所属店舗ID、役職、給与、人事評価、緊急連絡先 | 個人情報を含む＋機密 | 氏名、フリガナ、メール、電話番号、住所、生年月日、給与、人事評価、緊急連絡先 | 給与、人事評価 |

### 確認用に仕込むもの

- `stores.csv` は Shift_JIS で出力する。他はUTF-8
- `products.csv` の販売終了日、`stores.csv` の改装予定日、`orders.csv` の割引額、`customers.csv` の退会日、`employees.csv` の緊急連絡先に欠損を入れる
- `orders.csv` の顧客ID、店舗ID、商品ID、`employees.csv` の所属店舗IDは、他のファイルのIDと対応させる
- 出し分けの実演：閲覧者で見ると、商品・店舗はサンプルが全部見え、顧客は個人情報の5列だけ隠れ、注文・従業員は全部隠れる

`orders.csv` の顧客IDは、`customers.csv` と結びつけられるが、氏名などを直接含まないため `is_pii` にしない。注文は機密なので、サンプルはスチュワードだけが見られる。

### 実在のものに当たらないようにする

- 氏名：名字と名前のリストをランダムに組み合わせる
- メール：予約済みドメインの `@example.com` だけを使う
- 電話番号：`000-0000-XXXX` など、割り当てられない番号にする
- 住所：郵便番号は `000-XXXX`、市区町村以下は「サンプル市見本町1-2-3」のようにする

空ファイル、ヘッダーのみ、列数がそろわない行、ヘッダーの重複などの壊れたデータは、`tests/` 内の小さなデータで確認する。

## 環境

| 環境 | Supabase | 接続情報の場所 |
|---|---|---|
| ローカル、テスト | 開発用プロジェクト | `.env.local` |
| Vercel | 本番用プロジェクト | Vercelの環境変数 |

テストは開発用プロジェクトだけに接続する。Supabaseのテーブル変更は `supabase/migrations/` のファイルで管理する。

## テスト

- 単体：`src/lib/csv/`（統計値、個人情報の候補、伏せ処理）と `src/lib/datasets/`（入力チェック、状態と操作の可否、サンプルの組み立て）を `node --test` で確認する
- DB（開発用プロジェクト）：閲覧者、スチュワードA、スチュワードBでログインして確認する
  - 閲覧者は下書き・承認待ち・廃止のデータセットとその列を読めない
  - 閲覧者は、機密のデータセットのサンプルを1列も読めない。顧客では `is_pii` の列のサンプルだけ読めず、他の列は読める
  - スチュワードAが登録・依頼したものを、A自身は承認できない。Bは承認できる
  - クライアントから `status`、`approved_by` を直接更新すると権限エラーになる
  - 承認待ち・公開中のデータセットや列は編集できない
  - 状態の変更、項目の変更、サンプルの伏せ処理が `change_logs` に記録され、伏せる前の値が残っていない。閲覧者は `change_logs` を読めない
- 完了条件：`npm test` がすべて通り、Vercelの公開URLでログイン、登録、承認、検索、出し分けが動くこと

## 要件との確認事項

- **実演のアカウント数**：要件8は「2つのアカウント（スチュワードと閲覧者）」だが、自分の登録は承認できないため、承認まで見せるにはスチュワードが2人要る。スチュワード2人＋閲覧者1人の3アカウントで実演する。`.env.example` に2人目のスチュワードの変数を足した
- **公開中の修正**：公開中のデータセットを直すときは下書きに戻すため、再承認までの間は閲覧者から見えなくなる
- **承認依頼者の承認禁止**：要件は「登録した人」だけだが、依頼した人も承認できないようにしている
