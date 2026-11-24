// 確かめた提案を、ai_suggestions に保存する項目ごとの行に分ける（DB関数 save_ai_suggestions に渡す形）。

import type { AiField } from '../../types/database.ts';
import type { MetadataSuggestion } from './suggestion-schema.ts';

export type SuggestionItem = {
  field: AiField;
  column_name: string | null;
  suggested_value: unknown;
  reason: string;
};

function datasetItems(s: MetadataSuggestion): SuggestionItem[] {
  const { dataset } = s;
  const item = (field: AiField, value: unknown): SuggestionItem => ({
    field,
    column_name: null,
    suggested_value: value,
    reason: dataset.reason,
  });
  return [
    item('description', dataset.description),
    item('domain', dataset.domain),
    item('tags', [...dataset.tags].sort()),
    item('sensitivity', [...dataset.sensitivity].sort()),
  ];
}

function columnItems(s: MetadataSuggestion): SuggestionItem[] {
  return s.columns.flatMap((c) => {
    const item = (field: AiField, value: unknown): SuggestionItem => ({
      field,
      column_name: c.name,
      suggested_value: value,
      reason: c.reason,
    });
    return [
      item('column.description', c.description),
      item('column.sensitivity', c.sensitivity),
      item('column.is_pii', c.is_pii),
    ];
  });
}

export function toSuggestionItems(s: MetadataSuggestion): SuggestionItem[] {
  return [...datasetItems(s), ...columnItems(s)];
}
