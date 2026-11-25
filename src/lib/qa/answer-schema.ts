// AIに返してもらう回答の形（構造化出力の JSON Schema）と、回答を作る部品の型。

import type { ModelCall } from './claude-call.ts';
import type { RetrievedDataset } from './retriever.ts';

export const COVERAGES = ['full', 'partial', 'none'] as const;
export type Coverage = (typeof COVERAGES)[number];

export const COVERAGE_LABELS: Record<Coverage, string> = {
  full: 'カタログのデータで答えられます',
  partial: '一部しか答えられません',
  none: '該当するデータが見つかりません',
};

export type QaAnswer = {
  coverage: Coverage;
  answer: string;
  /** partial のときだけ1件以上 */
  missing_data: string[];
  cited_dataset_ids: string[];
};

export interface Answerer {
  answer(question: string, datasets: RetrievedDataset[]): Promise<{ raw: unknown; calls: ModelCall[] }>;
}

/** 引用できるIDを、検索で見つかったものだけに絞った Schema を作る */
export function buildAnswerJsonSchema(datasetIds: string[]): Record<string, unknown> {
  const idItems = datasetIds.length > 0 ? { type: 'string', enum: datasetIds } : { type: 'string' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['coverage', 'answer', 'missing_data', 'cited_dataset_ids'],
    properties: {
      coverage: { type: 'string', enum: [...COVERAGES] },
      answer: { type: 'string', description: '回答（日本語、400字以内）' },
      missing_data: { type: 'array', items: { type: 'string' }, description: '足りないデータ。partial のときだけ書く' },
      cited_dataset_ids: { type: 'array', items: idItems, description: '根拠にしたデータセットのID' },
    },
  };
}
