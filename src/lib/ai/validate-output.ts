// AIの返答を確かめる。構造化出力で形は決まっているが、値の組み合わせや列の対応は自分で確かめる。
// 1つでも問題があれば保存しない。

import type { ColumnSensitivity, Domain, Sensitivity } from '../../types/database.ts';
import { COLUMN_SENSITIVITY_LABELS, DOMAIN_LABELS, SENSITIVITY_LABELS } from '../datasets/labels.ts';
import { MAX_TAGS, MAX_TEXT_LENGTH, validateSensitivity, type ParseResult } from '../datasets/validation.ts';
import type {
  ColumnSuggestion,
  DatasetSuggestion,
  MetadataSuggestion,
  SuggestionInput,
} from './suggestion-schema.ts';

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(record: Record<T, string>, value: unknown): value is T {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(record, value);
}

/** 空でない文字列なら前後の空白を除いて返す。そうでなければエラーを足して null */
function readText(value: unknown, label: string, errors: string[]): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${label}が空です`);
    return null;
  }
  const text = value.trim();
  if (text.length > MAX_TEXT_LENGTH) {
    errors.push(`${label}が長すぎます`);
    return null;
  }
  return text;
}

/** タグを、前後の空白を除き重複をなくして返す */
export function normalizeTags(value: unknown, errors: string[]): string[] {
  if (!Array.isArray(value) || value.some((t) => typeof t !== 'string')) {
    errors.push('業務用語タグの形が正しくありません');
    return [];
  }
  const tags = [...new Set((value as string[]).map((t) => t.trim()).filter((t) => t !== ''))];
  if (tags.length > MAX_TAGS) errors.push(`業務用語タグは${MAX_TAGS}個までです`);
  return tags;
}

function readDatasetSensitivity(value: unknown, errors: string[]): Sensitivity[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((v) => isOneOf(SENSITIVITY_LABELS, v))) {
    errors.push('データセットの機微度の値が正しくありません');
    return [];
  }
  const values = [...new Set(value as Sensitivity[])];
  const problem = validateSensitivity(values);
  if (problem) errors.push(problem);
  return values;
}

function readDataset(value: unknown, errors: string[]): DatasetSuggestion | null {
  if (!isObject(value)) {
    errors.push('データセットの提案がありません');
    return null;
  }
  const description = readText(value.description, 'データセットの説明', errors);
  const domain: Domain | null = isOneOf(DOMAIN_LABELS, value.domain) ? value.domain : null;
  if (!domain) errors.push('データドメインの値が正しくありません');
  const tags = normalizeTags(value.tags, errors);
  const sensitivity = readDatasetSensitivity(value.sensitivity, errors);
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  if (!description || !domain) return null;
  return { description, domain, tags, sensitivity, reason };
}

function readColumn(value: unknown, errors: string[]): ColumnSuggestion | null {
  if (!isObject(value) || typeof value.name !== 'string') {
    errors.push('列の提案の形が正しくありません');
    return null;
  }
  const label = `列「${value.name}」`;
  const description = readText(value.description, `${label}の説明`, errors);
  const sensitivity: ColumnSensitivity | null = isOneOf(COLUMN_SENSITIVITY_LABELS, value.sensitivity)
    ? value.sensitivity
    : null;
  if (!sensitivity) errors.push(`${label}の機微度の値が正しくありません`);
  if (typeof value.is_pii !== 'boolean') errors.push(`${label}の個人情報の値が正しくありません`);
  if (value.is_pii === true && sensitivity === 'public') {
    errors.push(`${label}は個人情報なので、機微度を「公開」にできません`);
  }
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  if (!description || !sensitivity || typeof value.is_pii !== 'boolean') return null;
  return { name: value.name, description, sensitivity, is_pii: value.is_pii, reason };
}

/** 提案の列が、送った列と過不足なく1対1で対応しているか */
function checkColumnNames(columns: ColumnSuggestion[], input: SuggestionInput, errors: string[]): void {
  const expected = new Set(input.columns.map((c) => c.name));
  const seen = new Set<string>();
  for (const c of columns) {
    if (!expected.has(c.name)) errors.push(`提案に、存在しない列「${c.name}」があります`);
    if (seen.has(c.name)) errors.push(`列「${c.name}」の提案が重複しています`);
    seen.add(c.name);
  }
  for (const name of expected) {
    if (!seen.has(name)) errors.push(`列「${name}」の提案がありません`);
  }
}

export function validateSuggestion(raw: unknown, input: SuggestionInput): ParseResult<MetadataSuggestion> {
  const errors: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ['AIの返答の形が正しくありません'] };

  const dataset = readDataset(raw.dataset, errors);
  const rawColumns = Array.isArray(raw.columns) ? raw.columns : [];
  if (!Array.isArray(raw.columns)) errors.push('列の提案がありません');
  const columns = rawColumns.map((c) => readColumn(c, errors)).filter((c): c is ColumnSuggestion => c !== null);
  if (columns.length === rawColumns.length) checkColumnNames(columns, input, errors);

  if (errors.length > 0 || !dataset) return { ok: false, errors };
  return { ok: true, value: { dataset, columns } };
}
