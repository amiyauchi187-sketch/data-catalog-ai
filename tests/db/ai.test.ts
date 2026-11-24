// 開発用 Supabase プロジェクトで、AI提案の保存・判断・変更履歴・採用率の集計を確かめる。
// AIは呼ばない（提案の内容はテストで決めて save_ai_suggestions に直接渡す）。
// .env.local に接続情報、3つのテスト用アカウント、ALLOW_DB_TESTS=1 があるときだけ動く（無ければスキップ）。
// 作ったデータは名前に「[テスト]」を付け、最後に削除する。

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

/** 架空の顧客データの下書きを作る（メタデータは空のまま） */
async function createDraft(steward: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await steward.rpc('create_dataset', {
    payload: {
      name: `[テスト] ${name}`,
      source_file_name: 'test.csv',
      encoding: 'utf-8',
      row_count: 2,
      sample_count: 2,
      columns: [
        { position: 1, name: '顧客ID', data_type: 'text', null_count: 0, null_rate: 0, distinct_count: 2, is_pii: false, samples: ['C1', 'C2'] },
        { position: 2, name: '氏名', data_type: 'text', null_count: 0, null_rate: 0, distinct_count: 2, is_pii: false, samples: ['架空 太郎', '見本 花子'] },
      ],
    },
  });
  assert.ifError(error);
  return data as string;
}

const ITEMS = [
  { field: 'description', column_name: null, suggested_value: '顧客の一覧', reason: 'テスト' },
  { field: 'domain', column_name: null, suggested_value: 'customer', reason: 'テスト' },
  { field: 'tags', column_name: null, suggested_value: ['会員', '顧客'], reason: 'テスト' },
  { field: 'sensitivity', column_name: null, suggested_value: ['internal', 'personal'], reason: 'テスト' },
  { field: 'column.description', column_name: '顧客ID', suggested_value: '顧客の番号', reason: 'テスト' },
  { field: 'column.sensitivity', column_name: '顧客ID', suggested_value: 'internal', reason: 'テスト' },
  { field: 'column.is_pii', column_name: '顧客ID', suggested_value: false, reason: 'テスト' },
  { field: 'column.description', column_name: '氏名', suggested_value: '顧客の氏名', reason: 'テスト' },
  { field: 'column.sensitivity', column_name: '氏名', suggested_value: 'internal', reason: 'テスト' },
  { field: 'column.is_pii', column_name: '氏名', suggested_value: true, reason: 'テスト' },
];

async function saveSuggestions(client: SupabaseClient, datasetId: string) {
  return client.rpc('save_ai_suggestions', {
    p_dataset_id: datasetId,
    p_model: 'fake',
    p_prompt_version: 'test',
    p_usage: null,
    p_items: ITEMS,
  });
}

type Suggestion = { id: string; field: string; column_name: string | null; decision: string; decided_in_bulk: boolean };

async function pendingSuggestions(client: SupabaseClient, datasetId: string): Promise<Suggestion[]> {
  const { data, error } = await client
    .from('ai_suggestions')
    .select('id, field, column_name, decision, decided_in_bulk')
    .eq('dataset_id', datasetId)
    .eq('decision', 'pending');
  assert.ifError(error);
  return data as Suggestion[];
}

function find(list: Suggestion[], field: string, column: string | null = null): Suggestion {
  const s = list.find((x) => x.field === field && x.column_name === column);
  assert.ok(s, `${column ?? ''} ${field} の提案が無い`);
  return s;
}

async function logsOf(client: SupabaseClient, suggestionId: string) {
  const { data, error } = await client
    .from('change_logs')
    .select('field, old_value, new_value, suggested_value, ai_decision, note')
    .eq('suggestion_id', suggestionId);
  assert.ifError(error);
  return data ?? [];
}

describe('AI提案', { skip }, () => {
  let viewer: SupabaseClient;
  let steward: SupabaseClient;
  const created: string[] = [];

  before(async () => {
    viewer = await signIn('TEST_VIEWER_EMAIL', 'TEST_VIEWER_PASSWORD');
    steward = await signIn('TEST_STEWARD_EMAIL', 'TEST_STEWARD_PASSWORD');
  });

  after(async () => {
    for (const id of created) await steward.from('datasets').delete().eq('id', id);
  });

  test('閲覧者は提案を作れず、読めず、判断できない', async () => {
    const id = await createDraft(steward, 'AI 権限');
    created.push(id);
    assert.ok((await saveSuggestions(viewer, id)).error, '閲覧者の save_ai_suggestions はエラーになるはず');

    assert.ifError((await saveSuggestions(steward, id)).error);
    const { data } = await viewer.from('ai_suggestions').select('id').eq('dataset_id', id);
    assert.equal(data?.length ?? 0, 0);
    const stats = await viewer.from('ai_suggestion_stats').select('*');
    assert.equal(stats.data?.length ?? 0, 0);

    const s = find(await pendingSuggestions(steward, id), 'description');
    const r = await viewer.rpc('decide_ai_suggestion', { p_suggestion_id: s.id, p_decision: 'accepted' });
    assert.ok(r.error, '閲覧者の decide_ai_suggestion はエラーになるはず');
    // 提案を直接書き換えることもできない
    const u = await steward.from('ai_suggestions').update({ decision: 'accepted' }).eq('id', s.id);
    assert.ok(u.error, 'ai_suggestions は直接更新できないはず');
  });

  test('採用・修正・却下で、値と変更履歴（提案値・確定値・判断）が残る', async () => {
    const id = await createDraft(steward, 'AI 個別判断');
    created.push(id);
    assert.ifError((await saveSuggestions(steward, id)).error);
    const list = await pendingSuggestions(steward, id);

    // 採用
    const desc = find(list, 'description');
    assert.ifError((await steward.rpc('decide_ai_suggestion', { p_suggestion_id: desc.id, p_decision: 'accepted' })).error);
    const ds = await steward.from('datasets').select('description, domain').eq('id', id).single();
    assert.equal(ds.data!.description, '顧客の一覧');
    const descLogs = await logsOf(steward, desc.id);
    assert.equal(descLogs.length, 1);
    assert.equal(descLogs[0].ai_decision, 'accepted');
    assert.equal(descLogs[0].suggested_value, '顧客の一覧');
    assert.equal(descLogs[0].new_value, '顧客の一覧');

    // 修正して採用
    const domain = find(list, 'domain');
    assert.ifError(
      (await steward.rpc('decide_ai_suggestion', { p_suggestion_id: domain.id, p_decision: 'modified', p_final: 'sales' })).error,
    );
    const domainLogs = await logsOf(steward, domain.id);
    assert.equal(domainLogs[0].ai_decision, 'modified');
    assert.equal(domainLogs[0].suggested_value, 'customer');
    assert.equal(domainLogs[0].new_value, 'sales');

    // 修正したが提案と同じ値（並び順だけ違う）なら採用として数える
    const tags = find(list, 'tags');
    assert.ifError(
      (await steward.rpc('decide_ai_suggestion', { p_suggestion_id: tags.id, p_decision: 'modified', p_final: ['顧客', ' 会員'] })).error,
    );
    const tagRow = await steward.from('ai_suggestions').select('decision').eq('id', tags.id).single();
    assert.equal(tagRow.data!.decision, 'accepted');

    // 却下：値は変えず、履歴には残す
    const pii = find(list, 'column.is_pii', '氏名');
    assert.ifError((await steward.rpc('decide_ai_suggestion', { p_suggestion_id: pii.id, p_decision: 'rejected' })).error);
    const col = await steward.from('dataset_columns').select('is_pii').eq('dataset_id', id).eq('name', '氏名').single();
    assert.equal(col.data!.is_pii, false);
    const piiLogs = await logsOf(steward, pii.id);
    assert.equal(piiLogs.length, 1);
    assert.equal(piiLogs[0].ai_decision, 'rejected');
    assert.equal(piiLogs[0].suggested_value, true);
    assert.equal(piiLogs[0].new_value, false);

    // 同じ提案を2回判断できない
    const again = await steward.rpc('decide_ai_suggestion', { p_suggestion_id: desc.id, p_decision: 'rejected' });
    assert.ok(again.error);
  });

  test('未判断の提案があると承認依頼できず、まとめて採用すると提案ごとに履歴が残る', async () => {
    const id = await createDraft(steward, 'AI まとめて採用');
    created.push(id);
    const stewardId = (await steward.auth.getUser()).data.user!.id;
    assert.ifError((await steward.from('datasets').update({ steward_id: stewardId }).eq('id', id)).error);
    assert.ifError((await saveSuggestions(steward, id)).error);

    const blocked = await steward.rpc('submit_for_review', { p_dataset_id: id });
    assert.match(blocked.error?.message ?? '', /未判断のAI提案があります/);

    const bulk = await steward.rpc('decide_ai_suggestions_bulk', { p_dataset_id: id, p_decision: 'accepted' });
    assert.ifError(bulk.error);
    assert.equal(bulk.data, ITEMS.length);

    const { data: all } = await steward
      .from('ai_suggestions')
      .select('id, decision, decided_in_bulk')
      .eq('dataset_id', id);
    assert.equal(all!.length, ITEMS.length);
    for (const s of all!) {
      assert.equal(s.decision, 'accepted');
      assert.equal(s.decided_in_bulk, true);
      const logs = await logsOf(steward, s.id);
      assert.equal(logs.length, 1, '提案ごとに履歴が1行');
      assert.equal(logs[0].ai_decision, 'accepted');
      assert.equal(logs[0].note, 'まとめて採用');
    }

    // 氏名は個人情報になり、サンプルが伏せられている
    const col = await steward.from('dataset_columns').select('id, is_pii').eq('dataset_id', id).eq('name', '氏名').single();
    assert.equal(col.data!.is_pii, true);
    const sample = await steward.from('dataset_column_samples').select('sample_values').eq('column_id', col.data!.id).single();
    assert.deepEqual(sample.data!.sample_values, ['***', '***']);

    // すべて判断済みで、整合していれば承認依頼できる
    assert.ifError((await steward.rpc('submit_for_review', { p_dataset_id: id })).error);
    await steward.rpc('return_to_draft', { p_dataset_id: id, p_reason: 'テストの後片付け' });
  });

  test('まとめて却下しても提案ごとに履歴が残り、値は変わらない', async () => {
    const id = await createDraft(steward, 'AI まとめて却下');
    created.push(id);
    assert.ifError((await saveSuggestions(steward, id)).error);
    const bulk = await steward.rpc('decide_ai_suggestions_bulk', { p_dataset_id: id, p_decision: 'rejected' });
    assert.ifError(bulk.error);

    const ds = await steward.from('datasets').select('description, domain').eq('id', id).single();
    assert.equal(ds.data!.description, null);
    const { data: logs } = await steward
      .from('change_logs')
      .select('suggestion_id, ai_decision, note')
      .eq('dataset_id', id)
      .not('suggestion_id', 'is', null);
    assert.equal(logs!.length, ITEMS.length);
    assert.ok(logs!.every((l) => l.ai_decision === 'rejected' && l.note === 'まとめて却下'));
  });

  test('提案させ直すと、前回の未判断の提案は置き換え済みになる', async () => {
    const id = await createDraft(steward, 'AI 再提案');
    created.push(id);
    assert.ifError((await saveSuggestions(steward, id)).error);
    assert.ifError((await saveSuggestions(steward, id)).error);
    const { data } = await steward.from('ai_suggestions').select('decision').eq('dataset_id', id);
    assert.equal(data!.filter((s) => s.decision === 'superseded').length, ITEMS.length);
    assert.equal(data!.filter((s) => s.decision === 'pending').length, ITEMS.length);
  });

  test('存在しない列の提案は保存しない', async () => {
    const id = await createDraft(steward, 'AI 不明な列');
    created.push(id);
    const r = await steward.rpc('save_ai_suggestions', {
      p_dataset_id: id,
      p_model: 'fake',
      p_prompt_version: 'test',
      p_usage: null,
      p_items: [{ field: 'column.description', column_name: '存在しない列', suggested_value: 'x', reason: '' }],
    });
    assert.match(r.error?.message ?? '', /見つかりません/);
  });
});
