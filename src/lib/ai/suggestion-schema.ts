// AIに返してもらう提案の形（構造化出力の JSON Schema）と、その型。
// 選択肢は src/lib/datasets/labels.ts と同じ値にする。

import type { ColumnSensitivity, DataType, Domain, Sensitivity } from '../../types/database.ts';
import { COLUMN_SENSITIVITY_LABELS, DOMAIN_LABELS, SENSITIVITY_LABELS, keysOf } from '../datasets/labels.ts';

/** AIに送るデータ。要件6：データセット名・列名・型・統計値と、伏せたサンプル行だけ */
export type SuggestionInput = {
  dataset_name: string;
  row_count: number;
  column_count: number;
  columns: {
    name: string;
    data_type: DataType;
    null_rate: number;
    distinct_count: number;
    samples: (string | null)[];
  }[];
};

export type DatasetSuggestion = {
  description: string;
  domain: Domain;
  tags: string[];
  sensitivity: Sensitivity[];
  reason: string;
};

export type ColumnSuggestion = {
  name: string;
  description: string;
  sensitivity: ColumnSensitivity;
  is_pii: boolean;
  reason: string;
};

export type MetadataSuggestion = {
  dataset: DatasetSuggestion;
  columns: ColumnSuggestion[];
};

export const SUGGESTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dataset', 'columns'],
  properties: {
    dataset: {
      type: 'object',
      additionalProperties: false,
      required: ['description', 'domain', 'tags', 'sensitivity', 'reason'],
      properties: {
        description: { type: 'string', description: 'データセットの説明（日本語、200字以内）' },
        domain: { type: 'string', enum: keysOf(DOMAIN_LABELS) },
        tags: { type: 'array', items: { type: 'string' }, description: '業務用語タグ（日本語、3〜5個）' },
        sensitivity: { type: 'array', items: { type: 'string', enum: keysOf(SENSITIVITY_LABELS) } },
        reason: { type: 'string', description: '提案の根拠（日本語、100字以内）' },
      },
    },
    columns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'sensitivity', 'is_pii', 'reason'],
        properties: {
          name: { type: 'string', description: '入力の列名をそのまま' },
          description: { type: 'string', description: '列の説明（日本語、100字以内）' },
          sensitivity: { type: 'string', enum: keysOf(COLUMN_SENSITIVITY_LABELS) },
          is_pii: { type: 'boolean' },
          reason: { type: 'string', description: '提案の根拠（日本語、60字以内）' },
        },
      },
    },
  },
} as const;
