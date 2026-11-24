// AIに送るデータを組み立てる（要件6）。
// 送ってよい項目だけを一つずつ書き出す（許可リスト）。説明・オーナー・ファイル名などは送らない。
// サンプルは保存時に伏せてあるが、送る直前にもう一度伏せる。

import type { ColumnSample, Dataset, DatasetColumn } from '../../types/database.ts';
import { looksLikeEmail, looksLikePhone } from '../csv/detect-pii.ts';
import { MASK, maskIfPii } from '../csv/mask.ts';
import type { SuggestionInput } from './suggestion-schema.ts';

/** メールアドレスや電話番号の形をした値を伏せる（個人情報の列に指定されていなくても） */
export function maskPiiLikeValue(value: string | null): string | null {
  if (value === null || value === '') return value;
  return looksLikeEmail(value) || looksLikePhone(value) ? MASK : value;
}

/** 1列分のサンプルを、AIに送れる形にする */
export function samplesForAi(samples: (string | null)[], isPii: boolean): (string | null)[] {
  return maskIfPii(samples, isPii).map(maskPiiLikeValue);
}

export function buildSuggestionInput(
  dataset: Pick<Dataset, 'name' | 'row_count' | 'column_count'>,
  columns: DatasetColumn[],
  samples: ColumnSample[],
): SuggestionInput {
  const samplesByColumn = new Map(samples.map((s) => [s.column_id, s.sample_values]));
  return {
    dataset_name: dataset.name,
    row_count: dataset.row_count,
    column_count: dataset.column_count,
    columns: [...columns]
      .sort((a, b) => a.position - b.position)
      .map((c) => ({
        name: c.name,
        data_type: c.data_type,
        null_rate: c.null_rate,
        distinct_count: c.distinct_count,
        samples: samplesForAi(samplesByColumn.get(c.id) ?? [], c.is_pii),
      })),
  };
}
