import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseColumnForm,
  parseDatasetForm,
  parseTags,
  validateSensitivity,
} from '../../src/lib/datasets/validation.ts';
import { availableActions, isSelfApproval } from '../../src/lib/datasets/status.ts';
import { buildSampleRows, hasVisibleSamples, hiddenReason } from '../../src/lib/datasets/samples.ts';
import { buildCreatePayload, defaultDatasetName } from '../../src/lib/datasets/payload.ts';
import type { AnalyzedCsv } from '../../src/lib/csv/analyze.ts';

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

test('機微度の組み合わせを確認する', () => {
  assert.equal(validateSensitivity(['public']), null);
  assert.equal(validateSensitivity(['personal']), null);
  assert.equal(validateSensitivity(['personal', 'confidential']), null);
  assert.match(validateSensitivity(['public', 'personal']) ?? '', /公開/);
  assert.match(validateSensitivity(['internal', 'confidential']) ?? '', /社内/);
});

test('データセットのフォームを読み取る', () => {
  const result = parseDatasetForm(form([
    ['name', ' 顧客 '],
    ['description', ''],
    ['domain', 'customer'],
    ['sensitivity', 'personal'],
    ['sensitivity', 'internal'],
    ['update_frequency', 'daily'],
  ]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.name, '顧客');
  assert.equal(result.value.description, null);
  assert.deepEqual(result.value.sensitivity, ['personal', 'internal']);
});

test('データセットのフォームの誤りをまとめて返す', () => {
  const result = parseDatasetForm(form([
    ['name', ''],
    ['domain', 'other'],
    ['sensitivity', 'public'],
    ['sensitivity', 'confidential'],
  ]));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.length, 3);
});

test('タグを区切って重複を除く', () => {
  assert.deepEqual(parseTags('売上, 顧客、売上\n会員'), { ok: true, value: ['売上', '顧客', '会員'] });
  assert.equal(parseTags(Array.from({ length: 21 }, (_, i) => `t${i}`).join(',')).ok, false);
});

test('列のフォームで、個人情報の列を「公開」にはできない', () => {
  const ok = parseColumnForm(form([['col.c1.sensitivity', 'internal'], ['col.c1.is_pii', 'on']]), ['c1']);
  assert.deepEqual(ok, { ok: true, value: [{ id: 'c1', description: null, sensitivity: 'internal', is_pii: true }] });
  const ng = parseColumnForm(form([['col.c1.sensitivity', 'public'], ['col.c1.is_pii', 'on']]), ['c1']);
  assert.equal(ng.ok, false);
});

const stewardA = { userId: 'A', isSteward: true };
const stewardB = { userId: 'B', isSteward: true };

test('登録者と承認依頼者は承認できない', () => {
  const pending = { status: 'pending_review' as const, created_by: 'A', submitted_by: 'C', first_published_at: null };
  assert.equal(isSelfApproval(pending, 'A'), true);
  assert.equal(isSelfApproval(pending, 'C'), true);
  assert.deepEqual(availableActions(pending, stewardA), ['return']);
  assert.deepEqual(availableActions(pending, stewardB), ['approve', 'return']);
});

test('状態ごとの操作', () => {
  const base = { created_by: 'A', submitted_by: null, first_published_at: null };
  assert.deepEqual(availableActions({ ...base, status: 'draft' }, stewardA), ['edit', 'submit', 'delete']);
  assert.deepEqual(
    availableActions({ ...base, status: 'draft', first_published_at: '2026-11-10' }, stewardA),
    ['edit', 'submit'],
  );
  assert.deepEqual(availableActions({ ...base, status: 'published' }, stewardA), ['return', 'retire']);
  assert.deepEqual(availableActions({ ...base, status: 'retired' }, stewardA), []);
  assert.deepEqual(availableActions({ ...base, status: 'draft' }, { userId: 'V', isSteward: false }), []);
});

test('取れなかった列のサンプルを、理由つきで非表示にする', () => {
  const columns = [
    { id: 'c1', sensitivity: 'internal' as const, is_pii: false },
    { id: 'c2', sensitivity: 'internal' as const, is_pii: true },
  ];
  const rows = buildSampleRows(
    { sensitivity: ['personal'], sample_count: 2 },
    columns,
    [{ column_id: 'c1', sample_values: ['C1', null] }],
  );
  assert.deepEqual(rows, [
    [{ kind: 'value', value: 'C1' }, { kind: 'hidden', reason: 'personal' }],
    [{ kind: 'value', value: null }, { kind: 'hidden', reason: 'personal' }],
  ]);
  assert.equal(hasVisibleSamples(rows), true);
  assert.equal(hiddenReason({ sensitivity: ['personal', 'confidential'] }, columns[1]), 'confidential');
});

test('登録内容を作るとき、個人情報の列のサンプルを伏せる', () => {
  const analyzed: AnalyzedCsv = {
    encoding: 'shift_jis',
    rowCount: 3,
    columns: [
      { position: 1, name: 'ID', dataType: 'text', nullCount: 0, nullRate: 0, distinctCount: 3, samples: ['1', '2', '3'], piiReasons: [] },
      { position: 2, name: '氏名', dataType: 'text', nullCount: 1, nullRate: 0.3333, distinctCount: 2, samples: ['架空', null, '見本'], piiReasons: ['name'] },
    ],
  };
  const payload = buildCreatePayload(analyzed, { name: ' 顧客 ', fileName: 'customers.csv', piiPositions: new Set([2]) });
  assert.equal(payload.name, '顧客');
  assert.equal(payload.sample_count, 3);
  assert.deepEqual(payload.columns[0].samples, ['1', '2', '3']);
  assert.deepEqual(payload.columns[1].samples, ['***', null, '***']);
  assert.equal(defaultDatasetName('orders.CSV'), 'orders');
});
