// 本物のAIを呼ばずに、決まった提案を返す偽物。テストと、APIキーなしでの動作確認に使う。

import { matchesPiiName } from '../csv/detect-pii.ts';
import type { SuggestionInput } from './suggestion-schema.ts';
import type { MetadataSuggester, RawSuggestion } from './suggester.ts';

export const FAKE_MODEL = 'fake';

/** 入力の列名に合わせて、決まった規則で提案を作る（列名に個人情報の語があれば個人情報にする） */
export function buildFakeResponse(input: SuggestionInput): unknown {
  const columns = input.columns.map((c) => {
    const isPii = matchesPiiName(c.name);
    return {
      name: c.name,
      description: `${c.name}（架空の提案）`,
      sensitivity: 'internal',
      is_pii: isPii,
      reason: isPii ? '列名が個人情報を表すため' : '社内で使う値のため',
    };
  });
  const hasPii = columns.some((c) => c.is_pii);
  return {
    dataset: {
      description: `${input.dataset_name}のデータ（架空の提案）`,
      domain: 'sales',
      tags: ['架空タグ', 'テスト'],
      sensitivity: hasPii ? ['internal', 'personal'] : ['internal'],
      reason: '偽物の提案です',
    },
    columns,
  };
}

/** response を渡すとその内容をそのまま返す（テストで不正な返答を試すため） */
export function createFakeSuggester(response?: unknown): MetadataSuggester {
  return {
    async suggest(input: SuggestionInput): Promise<RawSuggestion> {
      return {
        raw: response === undefined ? buildFakeResponse(input) : response,
        model: FAKE_MODEL,
        usage: null,
      };
    },
  };
}
