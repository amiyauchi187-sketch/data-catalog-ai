// 一覧画面のURLの検索条件（?q=...&domain=...）を読み取る。選択肢にない値は捨てる。

import type { DatasetStatus, Domain, Sensitivity } from '../../types/database.ts';
import { DOMAIN_LABELS, SENSITIVITY_LABELS, STATUS_LABELS, keysOf } from './labels.ts';

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

/** 状態を何も選んでいないときに出す状態。廃止は「状態」で選んだときだけ出す */
export const DEFAULT_LIST_STATUSES: DatasetStatus[] = keysOf(STATUS_LABELS).filter((s) => s !== 'retired');

/** 一覧で検索する状態。何も選んでいなければ、廃止を除いたもの */
export function listStatuses(filters: SearchFilters): DatasetStatus[] {
  return filters.statuses.length > 0 ? filters.statuses : DEFAULT_LIST_STATUSES;
}
