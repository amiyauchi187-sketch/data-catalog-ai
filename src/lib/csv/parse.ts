// RFC 4180 の範囲のCSVパーサー（csv-tidy の csv.js を元にしている）と、
// ヘッダーとデータ行に分けて形を確認する処理。

/** CSVの文字列を、行ごとのフィールドの配列にする */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += ch;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else {
      field += ch;
    }
    i++;
  }

  if (inQuotes) throw new Error('CSVの引用符（"）が閉じられていません');
  // 末尾に改行がない最終行
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export type CsvTable = {
  header: string[];
  rows: string[][];
};

// 空行（フィールドが1つで空）は読み飛ばす
function isBlankRow(row: string[]): boolean {
  return row.length === 1 && row[0].trim() === '';
}

function validateHeader(header: string[]): string[] {
  const names = header.map((h) => h.trim());
  const emptyIndex = names.findIndex((n) => n === '');
  if (emptyIndex >= 0) {
    throw new Error(`${emptyIndex + 1}列目の列名が空です`);
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`列名「${name}」が重複しています`);
    seen.add(name);
  }
  return names;
}

/** CSVの文字列をヘッダーとデータ行に分け、列数がそろっているかを確認する */
export function toCsvTable(text: string): CsvTable {
  const allRows = parseCsvText(text).filter((row) => !isBlankRow(row));
  if (allRows.length === 0) throw new Error('ファイルが空です');

  const header = validateHeader(allRows[0]);
  const rows = allRows.slice(1);
  if (rows.length === 0) throw new Error('データの行がありません（ヘッダーだけです）');

  rows.forEach((row, index) => {
    if (row.length !== header.length) {
      // ヘッダーが1行目なので、データ行は2行目から数える
      throw new Error(
        `${index + 2}行目の列数が ${row.length} 個で、ヘッダーの ${header.length} 個とそろっていません`,
      );
    }
  });

  return { header, rows };
}
