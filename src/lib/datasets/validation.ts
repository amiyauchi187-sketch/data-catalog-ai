// 編集フォームの入力を読み取り、確認する。DBの制約と同じ規則を画面でも先に確かめる。

import type {
  ColumnSensitivity,
  Domain,
  Sensitivity,
  UpdateFrequency,
} from '../../types/database.ts';
import {
  COLUMN_SENSITIVITY_LABELS,
  DOMAIN_LABELS,
  SENSITIVITY_LABELS,
  UPDATE_FREQUENCY_LABELS,
} from './labels.ts';

export const MAX_TEXT_LENGTH = 2000;
export const MAX_NAME_LENGTH = 100;
export const MAX_TAGS = 20;

export type DatasetInput = {
  name: string;
  description: string | null;
  domain: Domain | null;
  sensitivity: Sensitivity[];
  owner_name: string | null;
  steward_id: string | null;
  usage_notes: string | null;
  source_system: string | null;
  update_frequency: UpdateFrequency | null;
};

export type ColumnInput = {
  id: string;
  description: string | null;
  sensitivity: ColumnSensitivity | null;
  is_pii: boolean;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function isOneOf<T extends string>(record: Record<T, string>, value: string): value is T {
  return Object.prototype.hasOwnProperty.call(record, value);
}

/** 前後の空白を除き、空なら null にする */
export function optionalText(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** データセットの機微度の組み合わせを確認する。問題なければ null */
export function validateSensitivity(values: Sensitivity[]): string | null {
  const set = new Set(values);
  if (set.has('public') && set.size > 1) {
    return '機微度「公開」は他の区分と一緒に選べません';
  }
  if (set.has('internal') && set.has('confidential')) {
    return '機微度「社内」と「機密」は一緒に選べません';
  }
  return null;
}

/** 選択肢の値を確認する。空なら null、選択肢にない値ならエラー */
function parseChoice<T extends string>(
  record: Record<T, string>,
  raw: FormDataEntryValue | null,
  label: string,
  errors: string[],
): T | null {
  const value = optionalText(raw);
  if (value === null) return null;
  if (isOneOf(record, value)) return value;
  errors.push(`${label}の値が正しくありません`);
  return null;
}

function parseSensitivityList(raw: FormDataEntryValue[], errors: string[]): Sensitivity[] {
  const values: Sensitivity[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && isOneOf(SENSITIVITY_LABELS, item)) {
      if (!values.includes(item)) values.push(item);
    } else {
      errors.push('機微度の値が正しくありません');
    }
  }
  const comboError = validateSensitivity(values);
  if (comboError) errors.push(comboError);
  return values;
}

function checkLength(value: string | null, max: number, label: string, errors: string[]): void {
  if (value !== null && value.length > max) {
    errors.push(`${label}は${max}文字以内で入力してください`);
  }
}

/** データセットの編集フォームを読み取る */
export function parseDatasetForm(form: FormData): ParseResult<DatasetInput> {
  const errors: string[] = [];
  const name = optionalText(form.get('name'));
  if (name === null) errors.push('名称を入力してください');

  const value: DatasetInput = {
    name: name ?? '',
    description: optionalText(form.get('description')),
    domain: parseChoice(DOMAIN_LABELS, form.get('domain'), 'データドメイン', errors),
    sensitivity: parseSensitivityList(form.getAll('sensitivity'), errors),
    owner_name: optionalText(form.get('owner_name')),
    steward_id: optionalText(form.get('steward_id')),
    usage_notes: optionalText(form.get('usage_notes')),
    source_system: optionalText(form.get('source_system')),
    update_frequency: parseChoice(UPDATE_FREQUENCY_LABELS, form.get('update_frequency'), '更新頻度', errors),
  };

  checkLength(value.name, MAX_NAME_LENGTH, '名称', errors);
  checkLength(value.description, MAX_TEXT_LENGTH, '説明', errors);
  checkLength(value.usage_notes, MAX_TEXT_LENGTH, '利用上の注意', errors);

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** タグの入力（カンマ、読点、改行区切り）を、重複のない配列にする */
export function parseTags(raw: FormDataEntryValue | null): ParseResult<string[]> {
  const text = typeof raw === 'string' ? raw : '';
  const tags = [...new Set(text.split(/[,、，\n]/).map((t) => t.trim()).filter((t) => t !== ''))];
  if (tags.length > MAX_TAGS) return { ok: false, errors: [`タグは${MAX_TAGS}個までです`] };
  const tooLong = tags.find((t) => t.length > 50);
  if (tooLong) return { ok: false, errors: [`タグ「${tooLong}」が長すぎます（50文字まで）`] };
  return { ok: true, value: tags };
}

/** 列の編集フォーム（col.<列ID>.description などの名前）を読み取る */
export function parseColumnForm(form: FormData, columnIds: string[]): ParseResult<ColumnInput[]> {
  const errors: string[] = [];
  const columns = columnIds.map((id) => {
    const description = optionalText(form.get(`col.${id}.description`));
    const sensitivity = parseChoice(
      COLUMN_SENSITIVITY_LABELS,
      form.get(`col.${id}.sensitivity`),
      '列の機微度',
      errors,
    );
    const isPii = form.get(`col.${id}.is_pii`) === 'on';
    checkLength(description, MAX_TEXT_LENGTH, '列の説明', errors);
    return { id, description, sensitivity, is_pii: isPii };
  });

  if (columns.some((c) => c.is_pii && c.sensitivity === 'public')) {
    errors.push('個人情報の列の機微度は「公開」にできません');
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: columns };
}
