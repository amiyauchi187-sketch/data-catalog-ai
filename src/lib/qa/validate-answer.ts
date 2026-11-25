// AIの回答を確かめる。構造化出力で形は決まっているが、「coverage によって必須」は Schema で書けないので、ここで確かめる。
// - 引用は検索で見つかったIDだけを残す
// - full／partial なのに有効な引用が0件なら none として扱う（根拠のない回答は出さない）
// - partial なのに足りないデータが空ならエラー

import { COVERAGES, type Coverage, type QaAnswer } from './answer-schema.ts';

export type AnswerCheck = { ok: true; value: QaAnswer } | { ok: false; errors: string[] };

export const NOT_FOUND_MESSAGE = 'カタログに該当するデータセットは見つかりませんでした。';

function isCoverage(value: unknown): value is Coverage {
  return typeof value === 'string' && (COVERAGES as readonly string[]).includes(value);
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean))];
}

export function notFoundAnswer(): QaAnswer {
  return { coverage: 'none', answer: NOT_FOUND_MESSAGE, missing_data: [], cited_dataset_ids: [] };
}

export function validateAnswer(raw: unknown, allowedIds: string[]): AnswerCheck {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (!isCoverage(obj.coverage)) return { ok: false, errors: ['AIの回答の判定（coverage）が読み取れませんでした'] };
  const answer = typeof obj.answer === 'string' ? obj.answer.trim() : '';
  if (obj.coverage === 'none') return { ok: true, value: { ...notFoundAnswer(), answer: answer || NOT_FOUND_MESSAGE } };

  const allowed = new Set(allowedIds);
  const cited = toStringList(obj.cited_dataset_ids).filter((id) => allowed.has(id));
  if (cited.length === 0) return { ok: true, value: notFoundAnswer() };
  if (answer === '') return { ok: false, errors: ['AIの回答が空でした'] };

  const missing = toStringList(obj.missing_data);
  if (obj.coverage === 'partial' && missing.length === 0) {
    return { ok: false, errors: ['AIの回答が「一部しか答えられない」なのに、足りないデータが書かれていませんでした'] };
  }
  return {
    ok: true,
    value: { coverage: obj.coverage, answer, missing_data: obj.coverage === 'partial' ? missing : [], cited_dataset_ids: cited },
  };
}
