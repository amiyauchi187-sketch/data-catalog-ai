// AIによるメタデータ提案の単体テスト。本物のAPIは呼ばず、決まった返答を返す偽物を使う。
// データはすべて架空のもの。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ColumnSample, DatasetColumn } from '../../src/types/database.ts';
import { buildSuggestionInput, maskPiiLikeValue } from '../../src/lib/ai/build-input.ts';
import { validateSuggestion } from '../../src/lib/ai/validate-output.ts';
import { toSuggestionItems } from '../../src/lib/ai/to-rows.ts';
import { computeAdoption, formatRate, sumCounts } from '../../src/lib/ai/adoption.ts';
import { parseFinalValue } from '../../src/lib/ai/parse-final.ts';
import { buildFakeResponse, createFakeSuggester, FAKE_MODEL } from '../../src/lib/ai/fake-suggester.ts';
import { getSuggester } from '../../src/lib/ai/suggester.ts';
import {
  CLAUDE_MODEL,
  createClaudeSuggester,
  toApiErrorMessage,
  type MessagesClient,
} from '../../src/lib/ai/claude-suggester.ts';
import { SUGGESTION_JSON_SCHEMA, type SuggestionInput } from '../../src/lib/ai/suggestion-schema.ts';
import { PROMPT_VERSION } from '../../src/lib/ai/prompt.ts';

// ---- 架空のデータ ----

function column(id: string, position: number, name: string, isPii: boolean): DatasetColumn {
  return {
    id,
    dataset_id: 'ds1',
    position,
    name,
    data_type: 'text',
    null_count: 0,
    null_rate: 0.1,
    distinct_count: 5,
    description: '既存の説明（送らない）',
    sensitivity: 'internal',
    is_pii: isPii,
  };
}

const DATASET = {
  id: 'ds1',
  name: '顧客マスタ',
  row_count: 500,
  column_count: 3,
  description: '既存の説明（送らない）',
  owner_name: '架空部（送らない）',
  source_file_name: 'customers.csv',
};

const COLUMNS = [column('c2', 2, '氏名', true), column('c1', 1, '顧客ID', false), column('c3', 3, '備考', false)];

const SAMPLES: ColumnSample[] = [
  { column_id: 'c1', sample_values: ['C0001', 'C0002', null] },
  { column_id: 'c2', sample_values: ['見本 太郎', '***', ''] },
  // 個人情報の列に指定されていないが、メールや電話番号の形の値が混ざっている
  { column_id: 'c3', sample_values: ['taro@example.com', '000-0000-0001', '特になし'] },
];

function input(): SuggestionInput {
  return buildSuggestionInput(DATASET, COLUMNS, SAMPLES);
}

function validResponse(): unknown {
  return {
    dataset: {
      description: '顧客の一覧',
      domain: 'customer',
      tags: [' 顧客 ', '会員', '顧客'],
      sensitivity: ['personal', 'internal'],
      reason: '氏名を含むため',
    },
    columns: [
      { name: '顧客ID', description: '顧客の番号', sensitivity: 'internal', is_pii: false, reason: '番号のみ' },
      { name: '氏名', description: '顧客の氏名', sensitivity: 'internal', is_pii: true, reason: '個人名' },
      { name: '備考', description: '自由記述', sensitivity: 'internal', is_pii: false, reason: '自由記述' },
    ],
  };
}

// ---- 送るデータ（要件6） ----

test('AIに送るのはデータセット名・件数・列名・型・統計値・サンプルだけ', () => {
  const sent = input();
  assert.deepEqual(Object.keys(sent).sort(), ['column_count', 'columns', 'dataset_name', 'row_count']);
  for (const c of sent.columns) {
    assert.deepEqual(Object.keys(c).sort(), ['data_type', 'distinct_count', 'name', 'null_rate', 'samples']);
  }
  const text = JSON.stringify(sent);
  assert.ok(!text.includes('既存の説明'));
  assert.ok(!text.includes('架空部'));
  assert.ok(!text.includes('customers.csv'));
});

test('列は position の順に並ぶ', () => {
  assert.deepEqual(input().columns.map((c) => c.name), ['顧客ID', '氏名', '備考']);
});

test('個人情報の列は送る直前にもう一度伏せる（null と空文字はそのまま）', () => {
  const pii = input().columns.find((c) => c.name === '氏名')!;
  assert.deepEqual(pii.samples, ['***', '***', '']);
});

test('個人情報の列でなくても、メールや電話番号の形の値は伏せる', () => {
  const memo = input().columns.find((c) => c.name === '備考')!;
  assert.deepEqual(memo.samples, ['***', '***', '特になし']);
  assert.equal(maskPiiLikeValue(null), null);
  assert.equal(maskPiiLikeValue('C0001'), 'C0001');
});

// ---- 返答の確認 ----

test('正しい返答は通り、タグの空白と重複が除かれる', () => {
  const result = validateSuggestion(validResponse(), input());
  assert.ok(result.ok);
  assert.deepEqual(result.value.dataset.tags, ['顧客', '会員']);
});

type Response = {
  dataset: Record<string, unknown>;
  columns: Record<string, unknown>[];
};

/** 正しい返答の一部を書き換えたものを作る */
function withChange(change: (r: Response) => void): unknown {
  const r = validResponse() as Response;
  change(r);
  return r;
}

test('列の過不足・重複があれば保存しない', () => {
  const missing = validateSuggestion(withChange((r) => r.columns.pop()), input());
  assert.ok(!missing.ok);
  assert.ok(missing.errors.some((e) => e.includes('「備考」の提案がありません')));

  const unknown = validateSuggestion(withChange((r) => (r.columns[2].name = '存在しない列')), input());
  assert.ok(!unknown.ok);
  assert.ok(unknown.errors.some((e) => e.includes('存在しない列')));

  const dup = validateSuggestion(withChange((r) => (r.columns[2].name = '氏名')), input());
  assert.ok(!dup.ok);
  assert.ok(dup.errors.some((e) => e.includes('重複')));
});

test('選択肢にない値や、許されない機微度の組み合わせは保存しない', () => {
  assert.ok(!validateSuggestion(withChange((r) => (r.dataset.domain = 'finance')), input()).ok);
  assert.ok(!validateSuggestion(withChange((r) => (r.dataset.sensitivity = ['public', 'personal'])), input()).ok);
  assert.ok(!validateSuggestion(withChange((r) => (r.dataset.sensitivity = ['internal', 'confidential'])), input()).ok);
  assert.ok(!validateSuggestion(withChange((r) => (r.dataset.sensitivity = [])), input()).ok);
  assert.ok(!validateSuggestion(withChange((r) => (r.columns[0].sensitivity = 'secret')), input()).ok);
  assert.ok(!validateSuggestion(withChange((r) => (r.columns[0].description = ' ')), input()).ok);
  assert.ok(!validateSuggestion('文字列', input()).ok);
});

test('個人情報の列を「公開」にする提案は保存しない', () => {
  const result = validateSuggestion(withChange((r) => (r.columns[1].sensitivity = 'public')), input());
  assert.ok(!result.ok);
  assert.ok(result.errors.some((e) => e.includes('公開')));
});

// ---- 項目ごとの行に分ける ----

test('提案を、データセット4項目＋列ごと3項目の行に分ける', () => {
  const checked = validateSuggestion(validResponse(), input());
  assert.ok(checked.ok);
  const items = toSuggestionItems(checked.value);
  assert.equal(items.length, 4 + 3 * 3);
  assert.deepEqual(
    items.filter((i) => i.column_name === null).map((i) => i.field),
    ['description', 'domain', 'tags', 'sensitivity'],
  );
  const sensitivity = items.find((i) => i.field === 'sensitivity')!;
  assert.deepEqual(sensitivity.suggested_value, ['internal', 'personal']);
  const pii = items.find((i) => i.field === 'column.is_pii' && i.column_name === '氏名')!;
  assert.equal(pii.suggested_value, true);
  assert.equal(pii.reason, '個人名');
});

// ---- 偽物の suggester ----

test('偽物は入力の列に合わせた、確認を通る提案を返す', async () => {
  const result = await createFakeSuggester().suggest(input());
  assert.equal(result.model, FAKE_MODEL);
  const checked = validateSuggestion(result.raw, input());
  assert.ok(checked.ok);
  assert.equal(checked.value.columns.find((c) => c.name === '氏名')!.is_pii, true);
  assert.deepEqual(checked.value.dataset.sensitivity, ['internal', 'personal']);
});

test('偽物に返答を渡すと、そのまま返す', async () => {
  const result = await createFakeSuggester({ broken: true }).suggest(input());
  assert.deepEqual(result.raw, { broken: true });
  assert.ok(!validateSuggestion(result.raw, input()).ok);
});

test('AI_SUGGESTER=fake なら偽物、Vercel の本番ではエラー、キーが無ければエラー', () => {
  assert.ok(getSuggester({ AI_SUGGESTER: 'fake' }));
  assert.throws(() => getSuggester({ AI_SUGGESTER: 'fake', VERCEL_ENV: 'production' }), /本番環境/);
  assert.throws(() => getSuggester({}), /APIキーが設定されていません/);
});

// ---- Claude の suggester（偽のクライアントを渡す） ----

function message(overrides: Partial<BetaMessage>): BetaMessage {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: CLAUDE_MODEL,
    content: [{ type: 'text', text: JSON.stringify(buildFakeResponse(input())), citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 800 },
    ...overrides,
  } as BetaMessage;
}

function fakeClient(response: BetaMessage | Error): { client: MessagesClient; sent: MessageCreateParamsNonStreaming[] } {
  const sent: MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    beta: {
      messages: {
        async create(params) {
          sent.push(params);
          if (response instanceof Error) throw response;
          return response;
        },
      },
    },
  };
  return { client, sent };
}

test('Claude には決まったモデル・スキーマ・送ってよいデータだけを渡す', async () => {
  const { client, sent } = fakeClient(message({}));
  const result = await createClaudeSuggester(client).suggest(input());

  assert.equal(sent.length, 1);
  const req = sent[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.deepEqual(req.output_config?.format, { type: 'json_schema', schema: SUGGESTION_JSON_SCHEMA });
  const userText = JSON.stringify(req.messages);
  assert.ok(userText.includes('顧客マスタ'));
  assert.ok(!userText.includes('既存の説明'));
  assert.ok(!userText.includes('taro@example.com'));
  assert.ok(!userText.includes('見本 太郎'));

  assert.equal(result.model, CLAUDE_MODEL);
  assert.deepEqual(result.usage, { input_tokens: 1200, output_tokens: 800 });
  assert.ok(validateSuggestion(result.raw, input()).ok);
});

test('断られた・途中で切れた・読めない返答は日本語のエラーにする', async () => {
  const cases: [Partial<BetaMessage>, RegExp][] = [
    [{ stop_reason: 'refusal' }, /断りました/],
    [{ stop_reason: 'max_tokens' }, /途中で切れました/],
    [{ content: [{ type: 'text', text: '{壊れたJSON', citations: null }] as BetaMessage['content'] }, /読み取れませんでした/],
    [{ content: [] }, /空でした/],
  ];
  for (const [overrides, pattern] of cases) {
    const { client } = fakeClient(message(overrides));
    await assert.rejects(createClaudeSuggester(client).suggest(input()), pattern);
  }
});

test('APIの失敗は、元のメッセージを出さずに日本語にする', async () => {
  const { client } = fakeClient(new Error('secret-like detail'));
  await assert.rejects(createClaudeSuggester(client).suggest(input()), (error: Error) => {
    assert.equal(error.message, 'AIの呼び出しに失敗しました');
    return true;
  });
  const conn = new Anthropic.APIConnectionError({ message: 'connection detail' });
  assert.match(toApiErrorMessage(conn), /接続できませんでした/);
});

// ---- 修正して採用の入力 ----

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

test('修正して採用の値を、項目ごとの形にする', () => {
  assert.deepEqual(parseFinalValue('description', form([['value', ' 説明 ']])), { ok: true, value: '説明' });
  assert.ok(!parseFinalValue('description', form([['value', ' ']])).ok);
  assert.deepEqual(parseFinalValue('domain', form([['value', 'hr']])), { ok: true, value: 'hr' });
  assert.ok(!parseFinalValue('domain', form([['value', 'finance']])).ok);
  assert.deepEqual(parseFinalValue('tags', form([['value', '顧客、会員,顧客']])), { ok: true, value: ['会員', '顧客'] });
  assert.deepEqual(
    parseFinalValue('sensitivity', form([['value', 'personal'], ['value', 'confidential']])),
    { ok: true, value: ['confidential', 'personal'] },
  );
  assert.ok(!parseFinalValue('sensitivity', form([['value', 'public'], ['value', 'personal']])).ok);
  assert.deepEqual(parseFinalValue('column.is_pii', form([['value', 'false']])), { ok: true, value: false });
  assert.deepEqual(parseFinalValue('column.sensitivity', form([['value', 'confidential']])), {
    ok: true,
    value: 'confidential',
  });
});

// ---- 採用率 ----

test('採用率は判断済みだけを分母にする', () => {
  const a = computeAdoption({ accepted: 6, modified: 2, rejected: 2, decided_in_bulk: 3 });
  assert.equal(a.decided, 10);
  assert.equal(a.acceptRate, 0.6);
  assert.equal(a.acceptOrModifyRate, 0.8);
  assert.equal(formatRate(a.acceptRate), '60.0%');

  const none = computeAdoption({ accepted: 0, modified: 0, rejected: 0, decided_in_bulk: 0 });
  assert.equal(none.acceptRate, null);
  assert.equal(formatRate(none.acceptRate), '—');

  assert.deepEqual(
    sumCounts([
      { accepted: 1, modified: 2, rejected: 3, decided_in_bulk: 1 },
      { accepted: 4, modified: 0, rejected: 1, decided_in_bulk: 0 },
    ]),
    { accepted: 5, modified: 2, rejected: 4, decided_in_bulk: 1 },
  );
});

test('プロンプトの版が決まっている', () => {
  assert.match(PROMPT_VERSION, /^v\d+$/);
});
