// 開発用 Supabase プロジェクトで、RLS・権限・DB関数を確かめる。
// .env.local に接続情報、3つのテスト用アカウント、ALLOW_DB_TESTS=1 があるときだけ動く（無ければスキップ）。
// 作ったデータは名前に「[テスト]」を付ける。下書きは最後に削除し、公開したものは廃止にする。

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const env = process.env;
const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'TEST_VIEWER_EMAIL',
  'TEST_VIEWER_PASSWORD',
  'TEST_STEWARD_EMAIL',
  'TEST_STEWARD_PASSWORD',
  'TEST_STEWARD2_EMAIL',
  'TEST_STEWARD2_PASSWORD',
];
const missing = REQUIRED.filter((key) => !env[key]);
const skip =
  env.ALLOW_DB_TESTS !== '1'
    ? 'ALLOW_DB_TESTS=1 が無いためスキップ（開発用プロジェクトでだけ動かす）'
    : missing.length > 0
      ? `環境変数が足りないためスキップ: ${missing.join(', ')}`
      : false;

async function signIn(emailKey: string, passwordKey: string): Promise<SupabaseClient> {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: env[emailKey]!, password: env[passwordKey]! });
  if (error) throw new Error(`${emailKey} でログインできませんでした`);
  return client;
}

async function userId(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getUser();
  return data.user!.id;
}

type Column = { name: string; is_pii: boolean; sensitivity: 'public' | 'internal' | 'confidential'; samples: (string | null)[] };

/** スチュワードAで下書きを作り、メタデータを入れる */
async function createDraft(
  steward: SupabaseClient,
  stewardId: string,
  name: string,
  sensitivity: string[],
  columns: Column[],
): Promise<string> {
  const { data: id, error } = await steward.rpc('create_dataset', {
    payload: {
      name: `[テスト] ${name}`,
      source_file_name: 'test.csv',
      encoding: 'utf-8',
      row_count: 2,
      sample_count: 2,
      columns: columns.map((c, i) => ({
        position: i + 1, name: c.name, data_type: 'text', null_count: 0, null_rate: 0, distinct_count: 2,
        is_pii: c.is_pii, samples: c.samples,
      })),
    },
  });
  assert.ifError(error);
  const update = await steward
    .from('datasets')
    .update({ description: 'テスト用', domain: 'customer', sensitivity, steward_id: stewardId })
    .eq('id', id);
  assert.ifError(update.error);
  const { data: cols } = await steward.from('dataset_columns').select('id, name').eq('dataset_id', id);
  for (const col of cols ?? []) {
    const spec = columns.find((c) => c.name === col.name)!;
    const r = await steward.from('dataset_columns').update({ sensitivity: spec.sensitivity }).eq('id', col.id);
    assert.ifError(r.error);
  }
  return id as string;
}

async function publish(submitter: SupabaseClient, approver: SupabaseClient, id: string): Promise<void> {
  assert.ifError((await submitter.rpc('submit_for_review', { p_dataset_id: id })).error);
  assert.ifError((await approver.rpc('approve_dataset', { p_dataset_id: id })).error);
}

async function visibleSampleColumns(client: SupabaseClient, datasetId: string): Promise<string[]> {
  const { data: cols } = await client.from('dataset_columns').select('id, name').eq('dataset_id', datasetId);
  const { data: samples } = await client
    .from('dataset_column_samples')
    .select('column_id')
    .in('column_id', (cols ?? []).map((c) => c.id));
  const visible = new Set((samples ?? []).map((s) => s.column_id));
  return (cols ?? []).filter((c) => visible.has(c.id)).map((c) => c.name).sort();
}

describe('RLS・権限・DB関数', { skip }, () => {
  let viewer: SupabaseClient;
  let stewardA: SupabaseClient;
  let stewardB: SupabaseClient;
  let stewardAId: string;
  const created: string[] = [];

  const customerColumns: Column[] = [
    { name: '顧客ID', is_pii: false, sensitivity: 'internal', samples: ['C1', 'C2'] },
    { name: '氏名', is_pii: true, sensitivity: 'internal', samples: ['架空 太郎', '見本 花子'] },
  ];

  before(async () => {
    viewer = await signIn('TEST_VIEWER_EMAIL', 'TEST_VIEWER_PASSWORD');
    stewardA = await signIn('TEST_STEWARD_EMAIL', 'TEST_STEWARD_PASSWORD');
    stewardB = await signIn('TEST_STEWARD2_EMAIL', 'TEST_STEWARD2_PASSWORD');
    stewardAId = await userId(stewardA);
  });

  after(async () => {
    // 後片付け：下書きは削除、公開中は廃止
    for (const id of created) {
      const { data } = await stewardA.from('datasets').select('status').eq('id', id).maybeSingle();
      if (data?.status === 'draft') await stewardA.from('datasets').delete().eq('id', id);
      if (data?.status === 'published') {
        await stewardA.rpc('retire_dataset', { p_dataset_id: id, p_reason: 'テストの後片付け' });
      }
    }
  });

  test('閲覧者は下書きを読めず、データセットを作れない', async () => {
    const id = await createDraft(stewardA, stewardAId, '下書き', ['personal'], customerColumns);
    created.push(id);
    const { data } = await viewer.from('datasets').select('id').eq('id', id);
    assert.equal(data?.length, 0);
    const cols = await viewer.from('dataset_columns').select('id').eq('dataset_id', id);
    assert.equal(cols.data?.length, 0);
    const { error } = await viewer.rpc('create_dataset', { payload: {} });
    assert.ok(error, '閲覧者の create_dataset はエラーになるはず');
  });

  test('個人情報の列は、生の値を送っても保存時に伏せられる', async () => {
    const id = await createDraft(stewardA, stewardAId, '伏せ処理', ['personal'], customerColumns);
    created.push(id);
    const { data: cols } = await stewardA.from('dataset_columns').select('id, name').eq('dataset_id', id);
    const nameCol = cols!.find((c) => c.name === '氏名')!;
    const { data } = await stewardA.from('dataset_column_samples').select('sample_values').eq('column_id', nameCol.id).single();
    assert.deepEqual(data!.sample_values, ['***', '***']);
  });

  test('状態と承認者は直接更新できない', async () => {
    const id = await createDraft(stewardA, stewardAId, '直接更新', ['personal'], customerColumns);
    created.push(id);
    const status = await stewardA.from('datasets').update({ status: 'published' }).eq('id', id);
    assert.ok(status.error, 'status の直接更新はエラーになるはず');
    const approver = await stewardB.from('datasets').update({ approved_by: stewardAId }).eq('id', id);
    assert.ok(approver.error, 'approved_by の直接更新はエラーになるはず');
  });

  test('自分の登録は承認できず、別のスチュワードは承認できる。承認待ちは編集できない', async () => {
    const id = await createDraft(stewardA, stewardAId, '承認', ['personal'], customerColumns);
    created.push(id);
    assert.ifError((await stewardA.rpc('submit_for_review', { p_dataset_id: id })).error);

    const locked = await stewardA.from('datasets').update({ name: '[テスト] 書き換え' }).eq('id', id).select('id');
    assert.equal(locked.data?.length ?? 0, 0, '承認待ちは更新できないはず');

    const self = await stewardA.rpc('approve_dataset', { p_dataset_id: id });
    assert.match(self.error?.message ?? '', /承認できません/);

    assert.ifError((await stewardB.rpc('approve_dataset', { p_dataset_id: id })).error);
    const { data } = await viewer.from('datasets').select('status, approved_by').eq('id', id).single();
    assert.equal(data!.status, 'published');
    assert.notEqual(data!.approved_by, stewardAId);
  });

  test('個人情報を含むデータセットは、閲覧者には個人情報の列のサンプルだけ見えない', async () => {
    const id = await createDraft(stewardA, stewardAId, '個人情報', ['personal'], customerColumns);
    created.push(id);
    await publish(stewardA, stewardB, id);
    assert.deepEqual(await visibleSampleColumns(viewer, id), ['顧客ID']);
    assert.deepEqual(await visibleSampleColumns(stewardB, id), ['氏名', '顧客ID']);
  });

  test('機密を含むデータセットは、閲覧者にはサンプルが1列も見えない', async () => {
    const columns: Column[] = [
      { name: '注文ID', is_pii: false, sensitivity: 'internal', samples: ['O1', 'O2'] },
      { name: '粗利額', is_pii: false, sensitivity: 'confidential', samples: ['100', '200'] },
    ];
    const id = await createDraft(stewardA, stewardAId, '機密', ['confidential'], columns);
    created.push(id);
    await publish(stewardA, stewardB, id);
    assert.deepEqual(await visibleSampleColumns(viewer, id), []);
    // メタデータ（列名）は見える
    const cols = await viewer.from('dataset_columns').select('name').eq('dataset_id', id);
    assert.equal(cols.data?.length, 2);
  });

  test('整合しない機微度では承認を依頼できない', async () => {
    const id = await createDraft(stewardA, stewardAId, '整合', ['internal'], customerColumns);
    created.push(id);
    const { error } = await stewardA.rpc('submit_for_review', { p_dataset_id: id });
    assert.match(error?.message ?? '', /個人情報を含む/);
  });

  test('公開中に個人情報の列を追加すると、伏せて下書きに戻る。履歴に伏せる前の値は残らない', async () => {
    const columns: Column[] = [
      { name: '顧客ID', is_pii: false, sensitivity: 'internal', samples: ['C1', 'C2'] },
      { name: '備考', is_pii: false, sensitivity: 'internal', samples: ['架空の電話 000-0000-9999', null] },
      { name: '氏名', is_pii: true, sensitivity: 'internal', samples: ['架空 太郎', '見本 花子'] },
    ];
    const id = await createDraft(stewardA, stewardAId, '後から伏せる', ['personal', 'internal'], columns);
    created.push(id);
    await publish(stewardA, stewardB, id);

    const { data: cols } = await stewardA.from('dataset_columns').select('id, name').eq('dataset_id', id);
    const note = cols!.find((c) => c.name === '備考')!;
    assert.ifError((await stewardB.rpc('set_column_pii', { p_column_id: note.id, p_is_pii: true })).error);

    const { data: ds } = await stewardA.from('datasets').select('status').eq('id', id).single();
    assert.equal(ds!.status, 'draft');
    const { data: sample } = await stewardA.from('dataset_column_samples').select('sample_values').eq('column_id', note.id).single();
    assert.deepEqual(sample!.sample_values, ['***', null]);

    const { data: logs } = await stewardA.from('change_logs').select('field, old_value, new_value').eq('dataset_id', id);
    const fields = (logs ?? []).map((l) => l.field);
    assert.ok(fields.includes('column.sample_masked'));
    assert.ok(fields.includes('status'));
    assert.ok(!JSON.stringify(logs).includes('000-0000-9999'), '伏せる前の値が履歴に残っている');

    const viewerLogs = await viewer.from('change_logs').select('id').eq('dataset_id', id);
    assert.equal(viewerLogs.data?.length ?? 0, 0, '閲覧者は変更履歴を読めないはず');
  });
});
