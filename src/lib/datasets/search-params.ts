// 一覧画面のURLの検索条件（?q=...&domain=...）を読み取る。選択肢にない値は捨てる。

import type { DatasetStatus, Domain, Sensitivity } from '../../types/database.ts';
import { DOMAIN_LABELS, SENSITIVITY_LABELS, STATUS_LABELS } from './labels.ts';

export type SearchFilters = {
  q: string;
  domains: Domain[];
  sensitivities: Sensitivity[];
  statuses: DatasetStatus[];
};

type RawParams = Record<string, string | string[] | undefined>;

function toList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function pick<T extends string>(record: Record<T, string>, value: string | string[] | undefined): T[] {
  return [...new Set(toList(value))].filter((v): v is T => Object.prototype.hasOwnProperty.call(record, v));
}

export function parseSearchFilters(params: RawParams): SearchFilters {
  const q = toList(params.q)[0] ?? '';
  return {
    q: q.trim().slice(0, 100),
    domains: pick(DOMAIN_LABELS, params.domain),
    sensitivities: pick(SENSITIVITY_LABELS, params.sensitivity),
    statuses: pick(STATUS_LABELS, params.status),
  };
}
