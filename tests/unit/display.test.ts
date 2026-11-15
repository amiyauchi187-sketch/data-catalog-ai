import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchFilters } from '../../src/lib/datasets/search-params.ts';
import { describeLogValue } from '../../src/lib/datasets/change-log-format.ts';
import { toUserMessage } from '../../src/lib/supabase/errors.ts';
import type { Profile } from '../../src/types/database.ts';

test('検索条件を読み取り、選択肢にない値は捨てる', () => {
  assert.deepEqual(
    parseSearchFilters({ q: '  顧客 ', domain: ['customer', 'other', 'customer'], sensitivity: 'personal', status: 'deleted' }),
    { q: '顧客', domains: ['customer'], sensitivities: ['personal'], statuses: [] },
  );
  assert.deepEqual(parseSearchFilters({}), { q: '', domains: [], sensitivities: [], statuses: [] });
});

test('変更履歴の値を日本語にする', () => {
  const profiles = new Map<string, Profile>([['u1', { id: 'u1', display_name: 'スチュワードA', role: 'steward' }]]);
  assert.equal(describeLogValue('status', 'pending_review', profiles), '承認待ち');
  assert.equal(describeLogValue('sensitivity', ['personal', 'confidential'], profiles), '個人情報を含む＋機密');
  assert.equal(describeLogValue('tags', [], profiles), 'なし');
  assert.equal(describeLogValue('steward_id', 'u1', profiles), 'スチュワードA');
  assert.equal(describeLogValue('column.is_pii', true, profiles), '個人情報');
  assert.equal(describeLogValue('description', null, profiles), '—');
  assert.equal(describeLogValue('description', 'あ'.repeat(100), profiles).length, 81);
});

test('DBのエラーは、日本語ならそのまま、それ以外は内部の情報を出さない', () => {
  assert.equal(toUserMessage({ code: 'P0001', message: '説明が入力されていません' }), '説明が入力されていません');
  assert.equal(toUserMessage({ code: '42501', message: 'permission denied for table datasets' }), 'この操作を行う権限がありません');
  assert.equal(
    toUserMessage({ code: '23514', message: 'new row violates check constraint "datasets_no_self_approval"' }),
    '入力内容が保存の条件を満たしていません',
  );
});
