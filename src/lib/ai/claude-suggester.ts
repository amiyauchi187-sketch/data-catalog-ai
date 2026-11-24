// Claude API で提案を作る。クライアントは引数で受け取り、テストでは偽物を渡す。
// APIキーや送った内容は、ログにもエラーメッセージにも出さない。

import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { buildUserMessage, SYSTEM_PROMPT } from './prompt.ts';
import { SUGGESTION_JSON_SCHEMA, type SuggestionInput } from './suggestion-schema.ts';
import type { MetadataSuggester, RawSuggestion } from './suggester.ts';

export const CLAUDE_MODEL = 'claude-opus-5-5';

/** 使うのは beta.messages.create だけ。テストの偽物はこの形を満たせばよい */
export type MessagesClient = {
  beta: { messages: { create(params: MessageCreateParamsNonStreaming): Promise<BetaMessage> } };
};

export function buildRequest(input: SuggestionInput): MessageCreateParamsNonStreaming {
  return {
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(input) }],
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: SUGGESTION_JSON_SCHEMA },
    },
    // 安全上の理由で断られたとき、サーバー側で別のモデルに切り替えて続ける
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
}

/** API の失敗を、利用者向けの日本語にする（元のメッセージは出さない） */
export function toApiErrorMessage(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'AIのAPIキーが正しくありません。管理者に連絡してください';
  if (error instanceof Anthropic.RateLimitError) return 'AIが混み合っています。しばらくしてからもう一度試してください';
  if (error instanceof Anthropic.APIConnectionError) return 'AIに接続できませんでした。しばらくしてからもう一度試してください';
  if (error instanceof Anthropic.APIError) return `AIの呼び出しに失敗しました（${error.status ?? '不明'}）`;
  return 'AIの呼び出しに失敗しました';
}

/** 返答から JSON を取り出す。読めなければ日本語のエラーを投げる */
export function readResponse(response: BetaMessage): unknown {
  if (response.stop_reason === 'refusal') {
    throw new Error('AIが提案を断りました。データセットの内容を確認してください');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('AIの返答が途中で切れました。列が多すぎる可能性があります');
  }
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('AIの返答が空でした');
  try {
    return JSON.parse(text.text);
  } catch {
    throw new Error('AIの返答を読み取れませんでした');
  }
}

export function createClaudeSuggester(client: MessagesClient): MetadataSuggester {
  return {
    async suggest(input: SuggestionInput): Promise<RawSuggestion> {
      let response: BetaMessage;
      try {
        response = await client.beta.messages.create(buildRequest(input));
      } catch (error) {
        throw new Error(toApiErrorMessage(error));
      }
      return {
        raw: readResponse(response),
        model: response.model,
        usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
      };
    },
  };
}
