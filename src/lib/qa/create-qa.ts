// 質問への回答の部品を組み立てる。探す部分をベクトル検索に替えるときは、ここの Retriever を差し替える。
// AI_SUGGESTER=fake のときは、AIを呼ばない偽物を使う（5.6と同じ切り替え）。

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Answerer } from './answer-schema.ts';
import { createClaudeAnswerer } from './claude-answerer.ts';
import { createFakeAnswerer } from './fake-answerer.ts';
import { createKeywordRetriever } from './keyword-retriever.ts';
import { createSupabaseCatalogReader } from './load-datasets.ts';
import { DEFAULT_ANSWERER_MODEL, DEFAULT_PLANNER_MODEL, resolveModel, type QaModel } from './models.ts';
import { createClaudePlanner, createFakePlanner, type QueryPlanner } from './query-planner.ts';
import type { DatasetRetriever } from './retriever.ts';

type Env = Record<string, string | undefined>;

export type QaComponents = { retriever: DatasetRetriever; answerer: Answerer };
export type QaModels = { planner: QaModel; answerer: QaModel };

/** 環境変数から、planner と answerer のモデルを決める */
export function resolveQaModels(env: Env): QaModels {
  return {
    planner: resolveModel(env.QA_PLANNER_MODEL, DEFAULT_PLANNER_MODEL, 'キーワードを取り出すAI（QA_PLANNER_MODEL）'),
    answerer: resolveModel(env.QA_ANSWERER_MODEL, DEFAULT_ANSWERER_MODEL, '回答するAI（QA_ANSWERER_MODEL）'),
  };
}

function isFakeMode(env: Env): boolean {
  if (env.AI_SUGGESTER !== 'fake') return false;
  // Vercel の本番では偽物を使わせない
  if (env.VERCEL_ENV === 'production') throw new Error('本番環境では AI_SUGGESTER=fake を使えません');
  return true;
}

function createAnthropic(env: Env): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new Error('AIのAPIキーが設定されていません。管理者に連絡してください');
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

/** supabase はログイン中の利用者のクライアントを渡す（RLSを効かせるため） */
export function createQa(supabase: SupabaseClient, env: Env, models: QaModels = resolveQaModels(env)): QaComponents {
  let planner: QueryPlanner;
  let answerer: Answerer;
  if (isFakeMode(env)) {
    planner = createFakePlanner();
    answerer = createFakeAnswerer();
  } else {
    const client = createAnthropic(env);
    planner = createClaudePlanner(client, models.planner);
    answerer = createClaudeAnswerer(client, models.answerer);
  }
  return { retriever: createKeywordRetriever(createSupabaseCatalogReader(supabase), planner), answerer };
}
