// 列ごとの統計値（型、欠損数・欠損率、ユニーク数）とサンプルを計算する。

import type { CsvTable } from './parse.ts';

export type ColumnDataType = 'integer' | 'decimal' | 'date' | 'boolean' | 'text';

export type ColumnProfile = {
  position: number;
  name: string;
  dataType: ColumnDataType;
  nullCount: number;
  nullRate: number;
  distinctCount: number;
  /** 先頭から最大5件。空の値は null */
  samples: (string | null)[];
};

export const MAX_SAMPLES = 5;

const INTEGER_PATTERN = /^[-+]?\d+$/;
const DECIMAL_PATTERN = /^[-+]?(\d+\.?\d*|\.\d+)$/;
const DATE_PATTERN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
const BOOLEAN_VALUES = new Set(['true', 'false']);

/** 空白だけの値は欠損として扱う */
export function isMissing(value: string): boolean {
  return value.trim() === '';
}

export function isValidDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** 欠損でない値すべてに当てはまる型を、厳しい順に選ぶ */
export function inferDataType(values: string[]): ColumnDataType {
  const present = values.map((v) => v.trim()).filter((v) => v !== '');
  if (present.length === 0) return 'text';
  if (present.every((v) => INTEGER_PATTERN.test(v))) return 'integer';
  if (present.every((v) => DECIMAL_PATTERN.test(v))) return 'decimal';
  if (present.every(isValidDate)) return 'date';
  if (present.every((v) => BOOLEAN_VALUES.has(v.toLowerCase()))) return 'boolean';
  return 'text';
}

/** 欠損率を小数4桁に丸める（DBの numeric(5,4) に合わせる） */
export function roundRate(count: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((count / total) * 10000) / 10000;
}

export function countDistinct(values: string[]): number {
  return new Set(values.filter((v) => !isMissing(v))).size;
}

export function pickSamples(values: string[]): (string | null)[] {
  return values.slice(0, MAX_SAMPLES).map((v) => (isMissing(v) ? null : v));
}

function columnValues(table: CsvTable, index: number): string[] {
  return table.rows.map((row) => row[index]);
}

/** 1列分の統計値を計算する */
export function profileColumn(name: string, position: number, values: string[]): ColumnProfile {
  const nullCount = values.filter(isMissing).length;
  return {
    position,
    name,
    dataType: inferDataType(values),
    nullCount,
    nullRate: roundRate(nullCount, values.length),
    distinctCount: countDistinct(values),
    samples: pickSamples(values),
  };
}

/** 全列の統計値を計算する */
export function profileTable(table: CsvTable): ColumnProfile[] {
  return table.header.map((name, index) => profileColumn(name, index + 1, columnValues(table, index)));
}
