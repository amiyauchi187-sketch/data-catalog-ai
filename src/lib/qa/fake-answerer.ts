// 本物のAIを呼ばずに、決まった回答を返す偽物。テストと、APIキーなしでの動作確認に使う。

import type { Answerer } from './answer-schema.ts';

/** response を渡すとその内容をそのまま返す。渡さなければ、見つかったものを全部根拠にした full を返す */
export function createFakeAnswerer(response?: unknown): Answerer {
  return {
    async answer(_question, datasets) {
      const raw =
        response !== undefined
          ? response
          : {
              coverage: 'full',
              answer: `${datasets.map((d) => d.name).join('、')} を使えます（架空の回答）`,
              missing_data: [],
              cited_dataset_ids: datasets.map((d) => d.id),
            };
      return { raw, calls: [] };
    },
  };
}
