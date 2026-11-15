// 変更履歴の値（jsonb）を画面に出す文字列にする

import type { Profile } from '../../types/database.ts';
import {
  COLUMN_SENSITIVITY_LABELS,
  DOMAIN_LABELS,
  SENSITIVITY_LABELS,
  STATUS_LABELS,
  UPDATE_FREQUENCY_LABELS,
} from './labels.ts';

const CHOICE_LABELS: Record<string, Record<string, string>> = {
  domain: DOMAIN_LABELS,
  status: STATUS_LABELS,
  update_frequency: UPDATE_FREQUENCY_LABELS,
  'column.sensitivity': COLUMN_SENSITIVITY_LABELS,
};

const MAX_LENGTH = 80;

function shorten(text: string): string {
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text;
}

function labelOf(labels: Record<string, string>, value: string): string {
  return labels[value] ?? value;
}

export function describeLogValue(field: string, value: unknown, profiles: Map<string, Profile>): string {
  if (value === null || value === undefined) return '—';
  if (field === 'sensitivity' && Array.isArray(value)) {
    return value.length === 0 ? '未設定' : value.map((v) => labelOf(SENSITIVITY_LABELS, String(v))).join('＋');
  }
  if (field === 'tags' && Array.isArray(value)) {
    return value.length === 0 ? 'なし' : value.join('、');
  }
  if (field === 'steward_id' && typeof value === 'string') {
    return profiles.get(value)?.display_name ?? '（不明）';
  }
  if (field === 'column.is_pii') {
    return value === true ? '個人情報' : '個人情報ではない';
  }
  if (CHOICE_LABELS[field] && typeof value === 'string') {
    return labelOf(CHOICE_LABELS[field], value);
  }
  return shorten(typeof value === 'string' ? value : JSON.stringify(value));
}
