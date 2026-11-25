// 質問から検索のキーワードを取り出す部品（キーワード検索でだけ使う）。
// 本番は Claude、テストと動作確認は決まった規則で取り出す偽物。

import type { Domain } from '../../types/database.ts';
import { DOMAIN_LABELS, keysOf } from '../datasets/labels.ts';
import { callStructured, type MessagesClient, type ModelCall } from './claude-call.ts';
import type { QaModel } from './models.ts';
import { buildPlannerMessage, PLANNER_SYSTEM_PROMPT } from './prompt.ts';

export type QueryPlan = { keywords: string[]; domains: Domain[] };

export interface QueryPlanner {
  plan(question: string): Promise<{ plan: QueryPlan; calls: ModelCall[] }>;
}

export const MAX_KEYWORDS = 5;
const MAX_KEYWORD_LENGTH = 20;
/** どのデータセットにも当たってしまう言葉 */
const STOP_WORDS = new Set(['データ', '分析', '一覧', '情報', '関係', '割合', '推移']);

export const PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['keywords', 'domains'],
  properties: {
    keywords: { type: 'array', items: { type: 'string' }, description: '検索キーワード（日本語の短い名詞、1〜5個）' },
    domains: { type: 'array', items: { type: 'string', enum: keysOf(DOMAIN_LABELS) } },
  },
};

/** 返ってきたキーワードを整える：前後の空白を除き、空・長すぎ・ありふれた言葉・重複を捨て、上限で切る */
export function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const words = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v !== '' && v.length <= MAX_KEYWORD_LENGTH && !STOP_WORDS.has(v));
  return [...new Set(words)].slice(0, MAX_KEYWORDS);
}

export function normalizeDomains(value: unknown): Domain[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set<string>(keysOf(DOMAIN_LABELS));
  return [...new Set(value.filter((v): v is Domain => typeof v === 'string' && valid.has(v)))];
}

/** AIの返答を検索条件にする。キーワードが1つも残らなければエラー */
export function toQueryPlan(raw: unknown): QueryPlan {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const keywords = normalizeKeywords(obj.keywords);
  if (keywords.length === 0) throw new Error('質問から検索の言葉を取り出せませんでした。言い方を変えて試してください');
  return { keywords, domains: normalizeDomains(obj.domains) };
}

export function createClaudePlanner(client: MessagesClient, model: QaModel): QueryPlanner {
  return {
    async plan(question) {
      const { raw, calls } = await callStructured(client, {
        model,
        effort: 'low',
        maxTokens: 2000,
        system: PLANNER_SYSTEM_PROMPT,
        user: buildPlannerMessage(question),
        schema: PLAN_JSON_SCHEMA,
      });
      return { plan: toQueryPlan(raw), calls };
    },
  };
}

/** 偽物：助詞や記号で区切った2文字以上の語をキーワードにする。plan を渡すとそれをそのまま返す */
export function createFakePlanner(plan?: QueryPlan): QueryPlanner {
  return {
    async plan(question) {
      if (plan) return { plan, calls: [] };
      const words = question.split(/[\sのをとがはにでもや、。？?！!「」]+|ごと|別|したい|知りたい|調べたい|見たい|ほしい/);
      const keywords = normalizeKeywords(words.filter((w) => w && w.length >= 2));
      return { plan: { keywords: keywords.length > 0 ? keywords : [question.slice(0, 10)], domains: [] }, calls: [] };
    },
  };
}
