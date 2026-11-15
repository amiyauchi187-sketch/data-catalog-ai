// CSVの読み取り結果から、DB関数 create_dataset に渡す内容を作る。
// 個人情報の列のサンプルは、ここで *** に伏せてから送る（DB関数でももう一度伏せる）。

import type { AnalyzedCsv } from '../csv/analyze.ts';
import { maskIfPii } from '../csv/mask.ts';

export type CreateDatasetPayload = {
  name: string;
  source_file_name: string;
  encoding: AnalyzedCsv['encoding'];
  row_count: number;
  sample_count: number;
  columns: {
    position: number;
    name: string;
    data_type: string;
    null_count: number;
    null_rate: number;
    distinct_count: number;
    is_pii: boolean;
    samples: (string | null)[];
  }[];
};

/** ファイル名から拡張子を除いて、データセット名の初期値にする */
export function defaultDatasetName(fileName: string): string {
  return fileName.replace(/\.csv$/i, '').trim() || '名称未設定';
}

export function buildCreatePayload(
  analyzed: AnalyzedCsv,
  options: { name: string; fileName: string; piiPositions: Set<number> },
): CreateDatasetPayload {
  const sampleCount = analyzed.columns[0]?.samples.length ?? 0;
  return {
    name: options.name.trim(),
    source_file_name: options.fileName,
    encoding: analyzed.encoding,
    row_count: analyzed.rowCount,
    sample_count: sampleCount,
    columns: analyzed.columns.map((c) => {
      const isPii = options.piiPositions.has(c.position);
      return {
        position: c.position,
        name: c.name,
        data_type: c.dataType,
        null_count: c.nullCount,
        null_rate: c.nullRate,
        distinct_count: c.distinctCount,
        is_pii: isPii,
        samples: maskIfPii(c.samples, isPii),
      };
    }),
  };
}
