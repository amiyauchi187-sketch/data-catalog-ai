// 開発用DBのシード（scripts/）の単体テスト。DBは使わない。データはすべて架空のもの。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_DATASETS, type DatasetSpec } from '../../scripts/dev-datasets.ts';
import { findSensitivityDiffs, type CurrentDataset } from '../../scripts/dataset-diff.ts';

function spec(name: string): DatasetSpec {
  const found = DEV_DATASETS.find((d) => d.name === name);
  assert.ok(found, `定義に「${name}」がない`);
  return found;
}

/** 定義どおりに登録したときの状態 */
function asDefined(s: DatasetSpec): CurrentDataset {
  return {
    sensitivity: [...s.sensitivity],
    columns: Object.entries(s.columns).map(([name, c]) => ({ name, sensitivity: c.sensitivity, is_pii: s.pii.includes(name) })),
  };
}

test('定義どおりなら食い違いはない（機微度の並び順は問わない）', () => {
  const employees = spec('従業員');
  const current = asDefined(employees);
  current.sensitivity.reverse();
  assert.deepEqual(findSensitivityDiffs(employees, current), []);
});

test('以前の顧客の設定（機密つき、個人情報の列が機密）は食い違いとして見つける', () => {
  const customers = spec('顧客');
  const current = asDefined(customers);
  current.sensitivity = ['confidential', 'personal'];
  current.columns = current.columns.map((c) => (c.is_pii ? { ...c, sensitivity: 'confidential' } : c));
  const diffs = findSensitivityDiffs(customers, current);
  assert.equal(diffs.length, 6);
  assert.equal(diffs[0], 'データセットの機微度：confidential＋personal → personal');
  assert.ok(diffs.includes('列「氏名」の機微度：confidential → internal'));
});

test('個人情報の指定の違いと、未設定の機微度も見つける', () => {
  const stores = spec('店舗');
  const current = asDefined(stores);
  current.columns[0] = { ...current.columns[0], sensitivity: null, is_pii: true };
  assert.deepEqual(findSensitivityDiffs(stores, current), [
    '列「店舗ID」の機微度：未設定 → internal',
    '列「店舗ID」の個人情報の指定：あり → なし',
  ]);
});

// ---- 定義そのものの確認（承認前のDBの検証と、要件の機微度に合っているか） ----

/** docs/requirements.md の「対象データ」の表 */
const REQUIRED_SENSITIVITY: Record<string, string[]> = {
  商品: ['public'],
  店舗: ['internal'],
  注文: ['confidential'],
  顧客: ['personal'],
  従業員: ['confidential', 'personal'],
};

test('5つの機微度が要件の表どおり', () => {
  assert.deepEqual(DEV_DATASETS.map((d) => d.name).sort(), Object.keys(REQUIRED_SENSITIVITY).sort());
  for (const d of DEV_DATASETS) {
    assert.deepEqual([...d.sensitivity].sort(), REQUIRED_SENSITIVITY[d.name], d.name);
  }
});

test('定義は承認前のDBの検証（check_dataset_ready）を通る組み合わせになっている', () => {
  for (const d of DEV_DATASETS) {
    const cols = Object.entries(d.columns);
    const hasPii = d.pii.length > 0;
    assert.equal(hasPii, d.sensitivity.includes('personal'), `${d.name}：個人情報の列と「個人情報を含む」`);
    if (cols.some(([, c]) => c.sensitivity === 'confidential')) {
      assert.ok(d.sensitivity.includes('confidential'), `${d.name}：機密の列があるのに「機密」がない`);
    }
    if (cols.some(([, c]) => c.sensitivity === 'internal')) {
      assert.ok(!d.sensitivity.includes('public'), `${d.name}：社内の列があるのに「公開」`);
    }
    for (const name of d.pii) {
      assert.notEqual(d.columns[name]?.sensitivity, 'public', `${d.name}：個人情報の列「${name}」が公開`);
    }
  }
});
