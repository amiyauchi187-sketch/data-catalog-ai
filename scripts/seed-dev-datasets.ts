// 開発用DBで、サンプルCSVの5つのデータセットを公開中にする。何度実行してもよい。
//   node --env-file-if-exists=.env.local scripts/seed-dev-datasets.ts   （npm run seed:dev）
//
// アプリと同じ普通の手順で行い、RLSや承認のルールを通る：
//   スチュワードA：CSVを読んで登録 → メタデータを入力 → 承認を依頼
//   スチュワードB：承認（自分の登録・依頼は承認できないため、別の人が行う）
// - すでに公開中で、定義どおりのものには触らない（作り直さない）
// - 以前の名前（customers など）で公開中のものは、下書きに戻して名前を直し、承認をやり直す
// - 公開中でも、機微度・個人情報の指定が定義と違うものは、下書きに戻して直し、承認をやり直す
//   （閲覧者に何が見えるかに関わるため。説明やタグの違いは見ない）
// - 途中で止まった下書き・承認待ちは、続きから進める
// - 列の説明は、まだ入っていないものだけを入れる（入力済みの値は上書きしない）
// 開発用プロジェクトでだけ動かす（ALLOW_DB_TESTS=1 のときだけ動く）。

import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { analyzeCsv } from '../src/lib/csv/analyze.ts';
import { buildCreatePayload } from '../src/lib/datasets/payload.ts';
import type { DatasetStatus } from '../src/types/database.ts';
import { DEV_DATASETS, type DatasetSpec } from './dev-datasets.ts';
import { findSensitivityDiffs, type CurrentDataset } from './dataset-diff.ts';

const env = process.env;
const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'TEST_STEWARD_EMAIL',
  'TEST_STEWARD_PASSWORD',
  'TEST_STEWARD2_EMAIL',
  'TEST_STEWARD2_PASSWORD',
];

type Steward = { client: SupabaseClient; id: string; label: string };
type Ctx = { a: Steward; b: Steward };
type Found = { id: string; name: string; status: DatasetStatus; created_by: string; submitted_by: string | null };

// ---- 準備 ----

function checkEnv(): void {
  if (env.ALLOW_DB_TESTS !== '1') {
    throw new Error('ALLOW_DB_TESTS=1 がないため止めました（開発用プロジェクトでだけ動かします）');
  }
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) throw new Error(`環境変数が足りません: ${missing.join(', ')}`);
}

async function signIn(emailKey: string, passwordKey: string, label: string): Promise<Steward> {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: env[emailKey]!, password: env[passwordKey]! });
  if (error || !data.user) throw new Error(`${label}でログインできませんでした`);
  return { client, id: data.user.id, label };
}

/** DBの返したエラーを、処理の名前を付けて投げる（DBのメッセージは日本語） */
function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}に失敗しました：${error.message}`);
}

// ---- 探す ----

/** 新しい名前か以前の名前で、廃止されていないものを探す。2件以上あれば止める */
async function findDataset(ctx: Ctx, spec: DatasetSpec): Promise<Found | null> {
  const { data, error } = await ctx.a.client
    .from('datasets')
    .select('id, name, status, created_by, submitted_by')
    .in('name', [spec.name, ...spec.legacyNames])
    .neq('status', 'retired');
  check(error, `「${spec.name}」の検索`);
  const rows = (data ?? []) as Found[];
  if (rows.length > 1) {
    throw new Error(`「${spec.name}」にあたるデータセットが${rows.length}件あります。どれを使うか決められないため止めました`);
  }
  return rows[0] ?? null;
}

/** 今の機微度と、列ごとの機微度・個人情報の指定を読む */
async function loadCurrent(ctx: Ctx, id: string, name: string): Promise<CurrentDataset> {
  const ds = await ctx.a.client.from('datasets').select('sensitivity').eq('id', id).single();
  check(ds.error, `「${name}」の読み込み`);
  if (!ds.data) throw new Error(`「${name}」が見つかりません`);
  const cols = await ctx.a.client.from('dataset_columns').select('name, sensitivity, is_pii').eq('dataset_id', id);
  check(cols.error, `「${name}」の列の読み込み`);
  return { sensitivity: ds.data.sensitivity, columns: cols.data ?? [] };
}

// ---- 登録と入力（スチュワードA） ----

async function createFromCsv(ctx: Ctx, spec: DatasetSpec): Promise<Found> {
  const analyzed = analyzeCsv(new Uint8Array(readFileSync(new URL(`../samples/${spec.file}`, import.meta.url))));
  assertColumnsMatch(spec, analyzed.columns.map((c) => c.name));
  const piiPositions = new Set(analyzed.columns.filter((c) => spec.pii.includes(c.name)).map((c) => c.position));
  const payload = buildCreatePayload(analyzed, { name: spec.name, fileName: spec.file, piiPositions });
  const { data, error } = await ctx.a.client.rpc('create_dataset', { payload });
  check(error, `「${spec.name}」の登録`);
  return { id: data as string, name: spec.name, status: 'draft', created_by: ctx.a.id, submitted_by: null };
}

/** 定義の列名とCSVの列名が一致しているかを確かめる（定義の書き間違いに備える） */
function assertColumnsMatch(spec: DatasetSpec, csvColumns: string[]): void {
  const defined = Object.keys(spec.columns);
  const missing = csvColumns.filter((c) => !defined.includes(c));
  const extra = [...defined, ...spec.pii].filter((c) => !csvColumns.includes(c));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`「${spec.name}」の列の定義がCSVと合いません（定義にない列：${missing.join('、') || 'なし'}、CSVにない列：${[...new Set(extra)].join('、') || 'なし'}）`);
  }
}

async function fillDataset(ctx: Ctx, id: string, spec: DatasetSpec): Promise<void> {
  const { error } = await ctx.a.client
    .from('datasets')
    .update({
      name: spec.name,
      description: spec.description,
      domain: spec.domain,
      sensitivity: spec.sensitivity,
      owner_name: spec.owner_name,
      steward_id: ctx.a.id,
      usage_notes: spec.usage_notes,
      source_system: spec.source_system,
      update_frequency: spec.update_frequency,
    })
    .eq('id', id);
  check(error, `「${spec.name}」のメタデータの入力`);
  const tags = await ctx.a.client.rpc('set_dataset_tags', { p_dataset_id: id, p_names: spec.tags });
  check(tags.error, `「${spec.name}」のタグの入力`);
}

/** 個人情報の指定を定義に合わせる（下書きのときだけ外せる。付けるとサンプルは *** に伏せられる） */
async function setPii(ctx: Ctx, columnId: string, isPii: boolean, label: string): Promise<void> {
  const { error } = await ctx.a.client.rpc('set_column_pii', { p_column_id: columnId, p_is_pii: isPii });
  check(error, `${label}の個人情報の指定`);
}

/** 列の機微度と個人情報の指定を定義に合わせ、説明はまだ空のものだけ入れる */
async function fillColumns(ctx: Ctx, id: string, spec: DatasetSpec): Promise<void> {
  const { data, error } = await ctx.a.client
    .from('dataset_columns')
    .select('id, name, sensitivity, description, is_pii')
    .eq('dataset_id', id);
  check(error, `「${spec.name}」の列の読み込み`);
  for (const col of data ?? []) {
    const columnSpec = spec.columns[col.name];
    if (!columnSpec) continue;
    const label = `「${spec.name}」の列「${col.name}」`;
    const shouldBePii = spec.pii.includes(col.name);
    if (col.is_pii !== shouldBePii) await setPii(ctx, col.id, shouldBePii, label);
    const changes: Record<string, string> = {};
    if (col.sensitivity !== columnSpec.sensitivity) changes.sensitivity = columnSpec.sensitivity;
    if (col.description === null && columnSpec.description) changes.description = columnSpec.description;
    if (Object.keys(changes).length === 0) continue;
    const r = await ctx.a.client.from('dataset_columns').update(changes).eq('id', col.id);
    check(r.error, `${label}の入力`);
  }
}

// ---- 状態の操作 ----

async function returnToDraft(ctx: Ctx, found: Found, reason: string): Promise<void> {
  const { error } = await ctx.a.client.rpc('return_to_draft', { p_dataset_id: found.id, p_reason: reason });
  check(error, `「${found.name}」を下書きに戻す処理`);
}

/** 登録者と依頼者は承認できないので、依頼は登録者（AかB）、承認はもう一人が行う */
function pickRoles(ctx: Ctx, createdBy: string): { submitter: Steward; approver: Steward } {
  return createdBy === ctx.b.id ? { submitter: ctx.b, approver: ctx.a } : { submitter: ctx.a, approver: ctx.b };
}

async function submit(submitter: Steward, id: string, name: string): Promise<void> {
  const { error } = await submitter.client.rpc('submit_for_review', { p_dataset_id: id });
  check(error, `「${name}」の承認依頼（${submitter.label}）`);
}

async function approve(approver: Steward, id: string, name: string): Promise<void> {
  const { error } = await approver.client.rpc('approve_dataset', { p_dataset_id: id });
  check(error, `「${name}」の承認（${approver.label}）`);
}

/** 承認待ちのものを、登録者でも依頼者でもない人が承認する */
async function approvePending(ctx: Ctx, found: Found): Promise<void> {
  const approver = [ctx.a, ctx.b].find((s) => s.id !== found.created_by && s.id !== found.submitted_by);
  if (!approver) throw new Error(`「${found.name}」を承認できるスチュワードがいません（登録者と依頼者が2人のどちらかのため）`);
  await approve(approver, found.id, found.name);
}

// ---- 1つ分の流れ ----

type Prepared = { draft: Found; action: string };

/** 公開中のもの：名前が違えば直す。機微度などが定義と違えば直す。定義どおりなら null（何もしない） */
async function reopenPublished(ctx: Ctx, found: Found, spec: DatasetSpec): Promise<Prepared | null> {
  if (found.name !== spec.name) {
    await returnToDraft(ctx, found, `名称を「${spec.name}」にそろえるため`);
    return { draft: found, action: `「${found.name}」を下書きに戻して名称を直し、公開し直しました` };
  }
  const diffs = findSensitivityDiffs(spec, await loadCurrent(ctx, found.id, spec.name));
  if (diffs.length === 0) return null;
  await returnToDraft(ctx, found, '機微度・個人情報の指定を要件に合わせるため');
  return { draft: found, action: `下書きに戻して直し、公開し直しました（${diffs.join('、')}）` };
}

/** 入力できる下書きの状態にする。何もしなくてよければ null */
async function prepareDraft(ctx: Ctx, found: Found | null, spec: DatasetSpec): Promise<Prepared | null> {
  if (!found) return { draft: await createFromCsv(ctx, spec), action: 'CSVから登録して公開しました' };
  if (found.status === 'draft') return { draft: found, action: '下書きの続きから公開しました' };
  return reopenPublished(ctx, found, spec);
}

/** 下書きに定義を入れ、承認を依頼して承認する */
async function publishDraft(ctx: Ctx, draft: Found, spec: DatasetSpec): Promise<void> {
  await fillDataset(ctx, draft.id, spec);
  await fillColumns(ctx, draft.id, spec);
  const { submitter, approver } = pickRoles(ctx, draft.created_by);
  await submit(submitter, draft.id, spec.name);
  await approve(approver, draft.id, spec.name);
}

async function seedOne(ctx: Ctx, spec: DatasetSpec): Promise<string> {
  const found = await findDataset(ctx, spec);
  if (found?.status === 'pending_review') {
    await approvePending(ctx, found);
    return '承認待ちだったものを承認しました（名前や機微度の違いは、次の実行で直します）';
  }
  const prepared = await prepareDraft(ctx, found, spec);
  if (!prepared) return '公開中で定義どおりのため何もしませんでした';
  await publishDraft(ctx, prepared.draft, spec);
  return prepared.action;
}

async function main(): Promise<void> {
  checkEnv();
  const ctx: Ctx = {
    a: await signIn('TEST_STEWARD_EMAIL', 'TEST_STEWARD_PASSWORD', 'スチュワードA'),
    b: await signIn('TEST_STEWARD2_EMAIL', 'TEST_STEWARD2_PASSWORD', 'スチュワードB'),
  };
  for (const spec of DEV_DATASETS) {
    console.log(`${spec.name}：${await seedOne(ctx, spec)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'データセットの準備に失敗しました');
  process.exit(1);
});
