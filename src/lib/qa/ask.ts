// 質問への回答の流れ：探す（Retriever）→ 0件なら「見つからない」→ 答える（Answerer）→ 回答を確かめる。
// Retriever と Answerer は引数で受け取るので、キーワード検索とベクトル検索、本物と偽物を差し替えられる。

import type { Answerer, QaAnswer } from './answer-schema.ts';
import type { ModelCall } from './claude-call.ts';
import type { DatasetRetriever, RetrievedDataset } from './retriever.ts';
import { notFoundAnswer, validateAnswer } from './validate-answer.ts';

export const DEFAULT_RETRIEVE_LIMIT = 8;
export const MAX_QUESTION_LENGTH = 200;

export type AskResult = QaAnswer & {
  /** 根拠のデータセット（リンクに使う）。引用されたものだけ、検索の順に並べる */
  sources: { id: string; name: string }[];
  /** 確認用：検索で見つかったもの、使ったキーワード、AIの呼び出し */
  retrieved: { id: string; name: string; score: number }[];
  keywords: string[];
  calls: ModelCall[];
};

/** 質問を整える。空や長すぎるものは日本語のエラー */
export function normalizeQuestion(value: unknown): string {
  const question = typeof value === 'string' ? value.trim() : '';
  if (question === '') throw new Error('質問を入力してください');
  if (question.length > MAX_QUESTION_LENGTH) throw new Error(`質問は${MAX_QUESTION_LENGTH}文字以内で入力してください`);
  return question;
}

function toSources(datasets: RetrievedDataset[], citedIds: string[]): { id: string; name: string }[] {
  const cited = new Set(citedIds);
  return datasets.filter((d) => cited.has(d.id)).map((d) => ({ id: d.id, name: d.name }));
}

export async function askQuestion(
  question: string,
  deps: { retriever: DatasetRetriever; answerer: Answerer; limit?: number },
): Promise<AskResult> {
  const found = await deps.retriever.retrieve(question, { limit: deps.limit ?? DEFAULT_RETRIEVE_LIMIT });
  const base = {
    retrieved: found.datasets.map((d) => ({ id: d.id, name: d.name, score: d.score })),
    keywords: found.keywords,
  };
  // 見つからなければ、AIに答えさせずに「見つからない」を返す
  if (found.datasets.length === 0) return { ...notFoundAnswer(), ...base, sources: [], calls: found.calls };

  const { raw, calls } = await deps.answerer.answer(question, found.datasets);
  const checked = validateAnswer(raw, found.datasets.map((d) => d.id));
  if (!checked.ok) throw new Error(checked.errors.join('。'));
  return {
    ...checked.value,
    ...base,
    sources: toSources(found.datasets, checked.value.cited_dataset_ids),
    calls: [...found.calls, ...calls],
  };
}
