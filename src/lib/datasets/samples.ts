// 列ごとに保存したサンプルを、画面に出す行の形に組み立てる。
// RLSで取れなかった列は「非表示」とし、その理由を列のメタデータから決める。

import type { ColumnSample, Dataset, DatasetColumn } from '../../types/database.ts';

export type HiddenReason = 'confidential' | 'personal';

export type SampleCell =
  | { kind: 'value'; value: string | null }
  | { kind: 'hidden'; reason: HiddenReason };

type ColumnMeta = Pick<DatasetColumn, 'id' | 'sensitivity' | 'is_pii'>;

/** サンプルが取れなかったときの理由。データセット全体が機密なら「機密」を優先する */
export function hiddenReason(dataset: Pick<Dataset, 'sensitivity'>, column: ColumnMeta): HiddenReason {
  if (dataset.sensitivity.includes('confidential') || column.sensitivity === 'confidential') {
    return 'confidential';
  }
  return 'personal';
}

export function hiddenReasonLabel(reason: HiddenReason): string {
  return reason === 'confidential' ? '非表示（機密）' : '非表示（個人情報）';
}

/** columns の順に、sampleCount 行分のセルを作る */
export function buildSampleRows(
  dataset: Pick<Dataset, 'sensitivity' | 'sample_count'>,
  columns: ColumnMeta[],
  samples: ColumnSample[],
): SampleCell[][] {
  const byColumn = new Map(samples.map((s) => [s.column_id, s.sample_values]));
  const rows: SampleCell[][] = [];
  for (let i = 0; i < dataset.sample_count; i++) {
    rows.push(
      columns.map((column): SampleCell => {
        const values = byColumn.get(column.id);
        if (!values) return { kind: 'hidden', reason: hiddenReason(dataset, column) };
        return { kind: 'value', value: values[i] ?? null };
      }),
    );
  }
  return rows;
}

/** 1列でもサンプルが見えるか */
export function hasVisibleSamples(rows: SampleCell[][]): boolean {
  return rows.some((row) => row.some((cell) => cell.kind === 'value'));
}
