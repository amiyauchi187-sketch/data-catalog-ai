// 質問への回答で Claude を呼ぶ共通部分。構造化出力で JSON を受け取り、使ったトークン数をモデルごとに返す。
// APIキーや送った内容は、ログにもエラーメッセージにも出さない。

import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { toApiErrorMessage } from '../ai/claude-suggester.ts';
import { QA_MODELS, type QaModel } from './models.ts';

/** 使うのは beta.messages.create だけ。テストの偽物はこの形を満たせばよい */
export type MessagesClient = {
  beta: { messages: { create(params: MessageCreateParamsNonStreaming): Promise<BetaMessage> } };
};

/** 1回の呼び出しで、どのモデルが何トークン使ったか（フォールバックがあれば複数行） */
export type ModelCall = { model: string; input_tokens: number; output_tokens: number };

export type StructuredRequest = {
  model: QaModel;
  effort: 'low' | 'medium' | 'high';
  maxTokens: number;
  system: string;
  user: string;
  schema: Record<string, unknown>;
};

/** モデルが受け付けるパラメータだけを入れてリクエストを作る */
export function buildRequest(req: StructuredRequest): MessageCreateParamsNonStreaming {
  const spec = QA_MODELS[req.model];
  const params: MessageCreateParamsNonStreaming = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
    output_config: {
      ...(spec.effort ? { effort: req.effort } : {}),
      format: { type: 'json_schema', schema: req.schema },
    },
  };
  if (spec.fallbacks) {
    // 安全上の理由で断られたとき、サーバー側で別のモデルに切り替えて続ける
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  return params;
}

/** 使ったトークン数。フォールバックがあれば、断られた側の分も iterations から数える */
export function collectUsage(response: BetaMessage): ModelCall[] {
  const iterations = response.usage.iterations ?? [];
  const calls = iterations
    .filter((it) => it.type === 'message' || it.type === 'fallback_message')
    .map((it) => ({
      model: ('model' in it && it.model) || response.model,
      input_tokens: it.input_tokens,
      output_tokens: it.output_tokens,
    }));
  if (calls.length > 0) return calls;
  return [{ model: response.model, input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }];
}

/** 返答から JSON を取り出す。読めなければ日本語のエラーを投げる */
export function readJson(response: BetaMessage): unknown {
  if (response.stop_reason === 'refusal') throw new Error('AIが回答を断りました。質問の内容を変えて試してください');
  if (response.stop_reason === 'max_tokens') throw new Error('AIの返答が途中で切れました');
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('AIの返答が空でした');
  try {
    return JSON.parse(text.text);
  } catch {
    throw new Error('AIの返答を読み取れませんでした');
  }
}

export async function callStructured(
  client: MessagesClient,
  req: StructuredRequest,
): Promise<{ raw: unknown; calls: ModelCall[] }> {
  let response: BetaMessage;
  try {
    response = await client.beta.messages.create(buildRequest(req));
  } catch (error) {
    throw new Error(toApiErrorMessage(error));
  }
  return { raw: readJson(response), calls: collectUsage(response) };
}
