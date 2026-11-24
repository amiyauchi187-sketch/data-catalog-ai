// AIで提案を作る部品の入口。本番は Claude、AI_SUGGESTER=fake のときは決まった提案を返す偽物を使う。

import Anthropic from '@anthropic-ai/sdk';
import type { SuggestionInput } from './suggestion-schema.ts';
import { createClaudeSuggester } from './claude-suggester.ts';
import { createFakeSuggester } from './fake-suggester.ts';

/** AIの返答そのもの（まだ確かめていない）と、使ったモデル・トークン数 */
export type RawSuggestion = {
  raw: unknown;
  model: string;
  usage: { input_tokens: number; output_tokens: number } | null;
};

export interface MetadataSuggester {
  suggest(input: SuggestionInput): Promise<RawSuggestion>;
}

type Env = Record<string, string | undefined>;

export function getSuggester(env: Env = process.env): MetadataSuggester {
  if (env.AI_SUGGESTER === 'fake') {
    // Vercel の本番では偽物を使わせない（ローカルの next start では使える）
    if (env.VERCEL_ENV === 'production') {
      throw new Error('本番環境では AI_SUGGESTER=fake を使えません');
    }
    return createFakeSuggester();
  }
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('AIのAPIキーが設定されていません。管理者に連絡してください');
  }
  return createClaudeSuggester(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }));
}
