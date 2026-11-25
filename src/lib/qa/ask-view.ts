// 質問の結果を、画面に渡す形にする。確認用の情報（AIの呼び出し、検索の点数）は画面に送らない。

import type { Coverage } from './answer-schema.ts';
import type { AskResult } from './ask.ts';

export type AskView = {
  question: string;
  coverage: Coverage;
  answer: string;
  missing_data: string[];
  /** 根拠のデータセット。リンクはアプリが ID から作る（AIには書かせない） */
  sources: { id: string; name: string; href: string }[];
  keywords: string[];
};

export type AskState = { result: AskView } | { errors: string[]; question?: string } | null;

export function datasetHref(id: string): string {
  return `/datasets/${encodeURIComponent(id)}`;
}

export function toAskView(question: string, result: AskResult): AskView {
  return {
    question,
    coverage: result.coverage,
    answer: result.answer,
    missing_data: result.coverage === 'partial' ? result.missing_data : [],
    sources: result.sources.map((s) => ({ ...s, href: datasetHref(s.id) })),
    keywords: result.keywords,
  };
}
