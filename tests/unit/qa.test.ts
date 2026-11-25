// 質問への回答（5.7）の単体テスト。本物のAPIとDBは呼ばず、偽の planner・answerer・読み取りを使う。
// データはすべて架空のもの。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ColumnSample } from '../../src/types/database.ts';
import { askQuestion, normalizeQuestion, MAX_QUESTION_LENGTH } from '../../src/lib/qa/ask.ts';
import { toAskView } from '../../src/lib/qa/ask-view.ts';
import { toContextDataset } from '../../src/lib/qa/build-context.ts';
import { buildRequest, collectUsage, readJson } from '../../src/lib/qa/claude-call.ts';
import { resolveQaModels } from '../../src/lib/qa/create-qa.ts';
import { createFakeAnswerer } from '../../src/lib/qa/fake-answerer.ts';
import { createKeywordRetriever, mergeHits } from '../../src/lib/qa/keyword-retriever.ts';
import type { CatalogReader, ColumnRow, DatasetRow } from '../../src/lib/qa/load-datasets.ts';
import { createFakePlanner, normalizeKeywords, toQueryPlan } from '../../src/lib/qa/query-planner.ts';
import type { Answerer } from '../../src/lib/qa/answer-schema.ts';
import { NOT_FOUND_MESSAGE, validateAnswer } from '../../src/lib/qa/validate-answer.ts';

// ---- 架空のカタログ ----

function row(id: string, name: string, domain: DatasetRow['domain'] = null): DatasetRow {
  return { id, name, description: `${name}の架空データ`, domain, sensitivity: ['internal'], usage_notes: null };
}

const ORDERS = row('ds-orders', '注文', 'sales');
const MEMBERS = row('ds-members', '会員', 'customer');
const SHOPS = row('ds-shops', '店舗');

const COLUMNS: ColumnRow[] = [
  { id: 'c2', dataset_id: 'ds-members', position: 2, name: 'メール', data_type: 'text', description: null, is_pii: true },
  { id: 'c1', dataset_id: 'ds-members', position: 1, name: '会員ランク', data_type: 'text', description: null, is_pii: false },
  { id: 'c3', dataset_id: 'ds-orders', position: 1, name: '売上金額', data_type: 'integer', description: '税込', is_pii: false },
];

const SAMPLES: ColumnSample[] = [
  { column_id: 'c1', sample_values: ['ゴールド', 'taro@example.com'] },
  { column_id: 'c2', sample_values: ['hanako@example.com'] },
  // c3 のサンプルは RLS で隠れた想定で返さない
];

/** キーワードごとに返す結果を決めた偽の読み取り。呼ばれたキーワードを記録する */
function fakeReader(byKeyword: Record<string, DatasetRow[]>) {
  const searched: string[] = [];
  const reader: CatalogReader = {
    async searchPublished(keyword) {
      searched.push(keyword);
      return byKeyword[keyword] ?? [];
    },
    async columns(ids) {
      return COLUMNS.filter((c) => ids.includes(c.dataset_id));
    },
    async samples(ids) {
      return SAMPLES.filter((s) => ids.includes(s.column_id));
    },
    async tags(ids) {
      return new Map(ids.includes('ds-orders') ? [['ds-orders', ['売上']]] : []);
    },
  };
  return { reader, searched };
}

// ---- 質問の入力 ----

test('質問は前後の空白を除き、空や長すぎるものは日本語のエラーにする', () => {
  assert.equal(normalizeQuestion('  客単価を出したい \n'), '客単価を出したい');
  assert.throws(() => normalizeQuestion('   '), /質問を入力してください/);
  assert.throws(() => normalizeQuestion(null), /質問を入力してください/);
  assert.throws(() => normalizeQuestion('あ'.repeat(MAX_QUESTION_LENGTH + 1)), /文字以内/);
});

// ---- 探す（キーワード検索） ----

test('キーワードごとの結果を合わせ、当たった数で並べる。ドメインの加点は同点を崩すだけ', () => {
  const hits = mergeHits([[ORDERS, MEMBERS], [ORDERS], [SHOPS, MEMBERS]], ['customer']);
  assert.deepEqual(
    hits.map((h) => [h.row.id, h.score]),
    [
      ['ds-members', 2.5],
      ['ds-orders', 2],
      ['ds-shops', 1],
    ],
  );
});

test('上位の件数で打ち切り、列・サンプル・タグを付ける。読めなかったサンプルは空', async () => {
  const { reader, searched } = fakeReader({ 売上: [ORDERS], 会員: [MEMBERS, ORDERS], 店舗: [SHOPS] });
  const planner = createFakePlanner({ keywords: ['売上', '会員', '店舗'], domains: [] });
  const result = await createKeywordRetriever(reader, planner).retrieve('質問', { limit: 2 });

  assert.deepEqual(searched, ['売上', '会員', '店舗']);
  assert.deepEqual(result.keywords, ['売上', '会員', '店舗']);
  assert.deepEqual(
    result.datasets.map((d) => d.id),
    ['ds-orders', 'ds-members'],
  );
  const members = result.datasets[1];
  assert.deepEqual(
    members.columns.map((c) => c.name),
    ['会員ランク', 'メール'],
  );
  const orders = result.datasets[0];
  assert.deepEqual(orders.tags, ['売上']);
  assert.deepEqual(orders.columns[0].samples, []);
});

test('キーワードを整える：空・長すぎ・ありふれた言葉・重複を捨て、5個までにする', () => {
  assert.deepEqual(normalizeKeywords([' 売上 ', '', 'データ', '売上', 'あ'.repeat(21), 1, 'a', 'b', 'c', 'd', 'e']), [
    '売上',
    'a',
    'b',
    'c',
    'd',
  ]);
  assert.throws(() => toQueryPlan({ keywords: ['データ'] }), /検索の言葉を取り出せませんでした/);
  assert.deepEqual(toQueryPlan({ keywords: ['売上'], domains: ['sales', 'unknown'] }).domains, ['sales']);
});

// ---- 根拠データの組み立て ----

test('AIに送る根拠データは許可した項目だけで、個人情報の列とメールらしい値は伏せる', () => {
  const ctx = toContextDataset({
    ...row('ds-members', '会員'),
    tags: ['顧客'],
    score: 3,
    columns: [
      { name: '会員ランク', data_type: 'text', description: null, samples: ['ゴールド', 'taro@example.com'], is_pii: false },
      { name: 'メール', data_type: 'text', description: null, samples: ['hanako@example.com'], is_pii: true },
    ],
  });
  assert.deepEqual(Object.keys(ctx).sort(), [
    'columns',
    'description',
    'domain',
    'id',
    'name',
    'sensitivity',
    'tags',
    'usage_notes',
  ]);
  assert.deepEqual(Object.keys(ctx.columns[0]).sort(), ['data_type', 'description', 'name', 'samples']);
  assert.deepEqual(ctx.columns[0].samples, ['ゴールド', '***']);
  assert.deepEqual(ctx.columns[1].samples, ['***']);
});

// ---- 回答の検証 ----

test('範囲外の引用は捨て、有効な引用が0件の full は none として扱う', () => {
  const kept = validateAnswer(
    { coverage: 'full', answer: '使えます', missing_data: ['無視される'], cited_dataset_ids: ['ds-orders', 'ds-other'] },
    ['ds-orders'],
  );
  assert.deepEqual(kept, {
    ok: true,
    value: { coverage: 'full', answer: '使えます', missing_data: [], cited_dataset_ids: ['ds-orders'] },
  });

  const none = validateAnswer({ coverage: 'full', answer: '使えます', missing_data: [], cited_dataset_ids: ['ds-other'] }, [
    'ds-orders',
  ]);
  assert.ok(none.ok);
  assert.equal(none.value.coverage, 'none');
  assert.equal(none.value.answer, NOT_FOUND_MESSAGE);
});

test('足りないデータが空の partial や、読めない coverage はエラーにする', () => {
  const partial = validateAnswer(
    { coverage: 'partial', answer: '一部だけ', missing_data: [' '], cited_dataset_ids: ['ds-orders'] },
    ['ds-orders'],
  );
  assert.equal(partial.ok, false);
  assert.equal(validateAnswer({ coverage: 'maybe' }, []).ok, false);
  assert.equal(validateAnswer('文字列', []).ok, false);
});

test('none のときは引用と足りないデータを無視する', () => {
  const result = validateAnswer(
    { coverage: 'none', answer: '', missing_data: ['天気'], cited_dataset_ids: ['ds-orders'] },
    ['ds-orders'],
  );
  assert.ok(result.ok);
  assert.deepEqual(result.value, { coverage: 'none', answer: NOT_FOUND_MESSAGE, missing_data: [], cited_dataset_ids: [] });
});

// ---- 全体の流れ ----

test('検索結果が0件なら answerer を呼ばずに「見つからない」を返す', async () => {
  let called = false;
  const answerer: Answerer = {
    async answer() {
      called = true;
      return { raw: {}, calls: [] };
    },
  };
  const { reader } = fakeReader({});
  const retriever = createKeywordRetriever(reader, createFakePlanner({ keywords: ['仕入先'], domains: [] }));
  const result = await askQuestion('仕入先ごとの納品リードタイムを調べたい', { retriever, answerer });

  assert.equal(called, false);
  assert.equal(result.coverage, 'none');
  assert.deepEqual(result.sources, []);
});

test('根拠は引用されたものだけを検索の順に並べ、画面用にはアプリがリンクを作る', async () => {
  const { reader } = fakeReader({ 天気: [], 注文: [ORDERS, SHOPS] });
  const retriever = createKeywordRetriever(reader, createFakePlanner({ keywords: ['天気', '注文'], domains: [] }));
  const answerer = createFakeAnswerer({
    coverage: 'partial',
    answer: '注文件数を来店数の代わりに使えます',
    missing_data: ['天気'],
    cited_dataset_ids: ['ds-orders', 'https://example.com/evil'],
  });
  const result = await askQuestion('天気と来店数の関係を調べたい', { retriever, answerer });
  const view = toAskView('天気と来店数の関係を調べたい', result);

  assert.equal(view.coverage, 'partial');
  assert.deepEqual(view.missing_data, ['天気']);
  assert.deepEqual(view.sources, [{ id: 'ds-orders', name: '注文', href: '/datasets/ds-orders' }]);
  assert.deepEqual(Object.keys(view).sort(), ['answer', 'coverage', 'keywords', 'missing_data', 'question', 'sources']);
});

test('回答に問題があれば日本語のエラーを投げる', async () => {
  const { reader } = fakeReader({ 注文: [ORDERS] });
  const retriever = createKeywordRetriever(reader, createFakePlanner({ keywords: ['注文'], domains: [] }));
  const answerer = createFakeAnswerer({ coverage: 'partial', answer: 'x', missing_data: [], cited_dataset_ids: ['ds-orders'] });
  await assert.rejects(askQuestion('質問', { retriever, answerer }), /足りないデータが書かれていませんでした/);
});

// ---- モデルごとのリクエスト ----

const BASE = { effort: 'low' as const, maxTokens: 100, system: 's', user: 'u', schema: { type: 'object' } };

test('Haiku 4.5 には effort と fallbacks を送らない', () => {
  const req = buildRequest({ ...BASE, model: 'claude-haiku-4-5' });
  assert.equal(req.output_config?.effort, undefined);
  assert.equal(req.fallbacks, undefined);
  assert.equal(req.betas, undefined);
  assert.deepEqual(req.output_config?.format, { type: 'json_schema', schema: BASE.schema });
});

test('Haiku 5.5 は effort だけ、Sonnet 5.5 は effort と fallbacks を送る', () => {
  const haiku = buildRequest({ ...BASE, model: 'claude-haiku-5-5' });
  assert.equal(haiku.output_config?.effort, 'low');
  assert.equal(haiku.fallbacks, undefined);

  const sonnet = buildRequest({ ...BASE, model: 'claude-sonnet-5-5', effort: 'medium' });
  assert.equal(sonnet.output_config?.effort, 'medium');
  assert.equal(sonnet.fallbacks, 'default');
});

test('モデル名は環境変数で選べ、一覧にない名前は日本語のエラーにする', () => {
  assert.deepEqual(resolveQaModels({}), { planner: 'claude-haiku-4-5', answerer: 'claude-sonnet-5-5' });
  assert.deepEqual(resolveQaModels({ QA_PLANNER_MODEL: 'claude-haiku-5-5', QA_ANSWERER_MODEL: 'claude-opus-5-5' }), {
    planner: 'claude-haiku-5-5',
    answerer: 'claude-opus-5-5',
  });
  assert.throws(() => resolveQaModels({ QA_ANSWERER_MODEL: 'gpt-x' }), /QA_ANSWERER_MODEL.*使えません/);
});

function message(overrides: Partial<BetaMessage>): BetaMessage {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text: '{"keywords":["売上"]}', citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
    ...overrides,
  } as BetaMessage;
}

test('返答の JSON を読み、断られたときは日本語のエラーにする', () => {
  assert.deepEqual(readJson(message({})), { keywords: ['売上'] });
  assert.throws(() => readJson(message({ stop_reason: 'refusal' })), /AIが回答を断りました/);
  assert.throws(() => readJson(message({ content: [{ type: 'text', text: '{壊れた', citations: null }] } as Partial<BetaMessage>)), /読み取れませんでした/);
});

test('トークン数は iterations があればその合計（フォールバックで断られた側の分も数える）', () => {
  const plain = collectUsage(message({}));
  assert.deepEqual(plain, [{ model: 'claude-sonnet-5-5', input_tokens: 100, output_tokens: 20 }]);

  const withFallback = collectUsage(
    message({
      usage: {
        input_tokens: 300,
        output_tokens: 50,
        iterations: [
          { type: 'message', model: 'claude-sonnet-5-5', input_tokens: 100, output_tokens: 5 },
          { type: 'fallback_message', model: 'claude-opus-5-5', input_tokens: 200, output_tokens: 45 },
        ],
      },
    } as unknown as Partial<BetaMessage>),
  );
  assert.deepEqual(
    withFallback.map((c) => [c.model, c.input_tokens]),
    [
      ['claude-sonnet-5-5', 100],
      ['claude-opus-5-5', 200],
    ],
  );
});
