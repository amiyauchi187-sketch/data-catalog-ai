// アップロードしたCSVを読み、登録画面に出す内容をまとめる。ブラウザ内で動く。

import { decodeCsvBytes, type CsvEncoding } from './decode.ts';
import { toCsvTable } from './parse.ts';
import { profileTable, type ColumnProfile } from './profile.ts';
import { detectPiiReasons, type PiiReason } from './detect-pii.ts';

export type AnalyzedColumn = ColumnProfile & {
  piiReasons: PiiReason[];
};

export type AnalyzedCsv = {
  encoding: CsvEncoding;
  rowCount: number;
  columns: AnalyzedColumn[];
};

/** バイト列から、文字コード・件数・列ごとの統計値と個人情報の候補を求める */
export function analyzeCsv(buf: Uint8Array): AnalyzedCsv {
  const { text, encoding } = decodeCsvBytes(buf);
  const table = toCsvTable(text);
  const profiles = profileTable(table);
  const columns = profiles.map((profile, index) => ({
    ...profile,
    piiReasons: detectPiiReasons(profile.name, table.rows.map((row) => row[index])),
  }));
  return { encoding, rowCount: table.rows.length, columns };
}
