// 「修正して採用」で入力された値を、項目ごとの形（DBに渡す jsonb）にする。
// 入力欄の名前は value（機微度だけ複数選択なので getAll で読む）。

import type { AiField } from '../../types/database.ts';
import { COLUMN_SENSITIVITY_LABELS, DOMAIN_LABELS, SENSITIVITY_LABELS } from '../datasets/labels.ts';
import {
  MAX_TEXT_LENGTH,
  optionalText,
  parseTags,
  validateSensitivity,
  type ParseResult,
} from '../datasets/validation.ts';

function ok(value: unknown): ParseResult<unknown> {
  return { ok: true, value };
}

function ng(message: string): ParseResult<unknown> {
  return { ok: false, errors: [message] };
}

function parseText(form: FormData, label: string): ParseResult<unknown> {
  const text = optionalText(form.get('value'));
  if (text === null) return ng(`${label}を入力してください`);
  if (text.length > MAX_TEXT_LENGTH) return ng(`${label}は${MAX_TEXT_LENGTH}文字以内で入力してください`);
  return ok(text);
}

function parseChoice(form: FormData, record: Record<string, string>, label: string): ParseResult<unknown> {
  const value = optionalText(form.get('value'));
  if (value === null || !Object.prototype.hasOwnProperty.call(record, value)) return ng(`${label}を選んでください`);
  return ok(value);
}

function parseSensitivities(form: FormData): ParseResult<unknown> {
  const values = [...new Set(form.getAll('value').map(String))];
  if (values.length === 0) return ng('機微度を1つ以上選んでください');
  if (!values.every((v) => Object.prototype.hasOwnProperty.call(SENSITIVITY_LABELS, v))) {
    return ng('機微度の値が正しくありません');
  }
  const problem = validateSensitivity(values as (keyof typeof SENSITIVITY_LABELS)[]);
  return problem ? ng(problem) : ok(values.sort());
}

function parseTagList(form: FormData): ParseResult<unknown> {
  const tags = parseTags(form.get('value'));
  if (!tags.ok) return tags;
  if (tags.value.length === 0) return ng('タグを1つ以上入力してください');
  return ok([...tags.value].sort());
}

function parseBoolean(form: FormData): ParseResult<unknown> {
  const value = form.get('value');
  if (value === 'true') return ok(true);
  if (value === 'false') return ok(false);
  return ng('個人情報かどうかを選んでください');
}

export function parseFinalValue(field: AiField, form: FormData): ParseResult<unknown> {
  switch (field) {
    case 'description':
      return parseText(form, '説明');
    case 'column.description':
      return parseText(form, '列の説明');
    case 'domain':
      return parseChoice(form, DOMAIN_LABELS, 'データドメイン');
    case 'column.sensitivity':
      return parseChoice(form, COLUMN_SENSITIVITY_LABELS, '列の機微度');
    case 'sensitivity':
      return parseSensitivities(form);
    case 'tags':
      return parseTagList(form);
    case 'column.is_pii':
      return parseBoolean(form);
  }
}
