// CSVのバイト列を文字列にする。対応する文字コードは UTF-8 と Shift_JIS だけ。
// csv-tidy の encoding.js を元にしている（TextDecoder の fatal モードで試す）。

export type CsvEncoding = 'utf-8' | 'shift_jis';

export type DecodedText = {
  text: string;
  encoding: CsvEncoding;
};

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16_BOMS = [
  [0xff, 0xfe],
  [0xfe, 0xff],
];

function startsWith(buf: Uint8Array, bytes: number[]): boolean {
  return bytes.every((b, i) => buf[i] === b);
}

function tryDecode(buf: Uint8Array, label: string): string | null {
  try {
    return new TextDecoder(label, { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

// EUC-JP のバイト列は Shift_JIS としてもデコードできてしまうことが多い。
// その場合は半角カナ（U+FF61〜FF9F）だらけになるので、それで見分ける。
function halfWidthKanaCount(text: string): number {
  let count = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0xff61 && code <= 0xff9f) count++;
  }
  return count;
}

function looksLikeEucJp(buf: Uint8Array, sjisText: string): boolean {
  const eucText = tryDecode(buf, 'euc-jp');
  return eucText !== null && halfWidthKanaCount(eucText) < halfWidthKanaCount(sjisText);
}

/** 文字コードを判定して文字列にする。対応していない文字コードならエラーにする */
export function decodeCsvBytes(buf: Uint8Array): DecodedText {
  if (startsWith(buf, UTF8_BOM)) {
    return { text: new TextDecoder('utf-8').decode(buf.subarray(UTF8_BOM.length)), encoding: 'utf-8' };
  }
  if (UTF16_BOMS.some((bom) => startsWith(buf, bom))) {
    throw new Error('UTF-16 のファイルには対応していません。UTF-8 か Shift_JIS で保存し直してください');
  }

  const utf8 = tryDecode(buf, 'utf-8');
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8' };

  const sjis = tryDecode(buf, 'shift_jis');
  if (sjis !== null && !looksLikeEucJp(buf, sjis)) return { text: sjis, encoding: 'shift_jis' };

  throw new Error('文字コードを判定できませんでした。UTF-8 か Shift_JIS で保存し直してください');
}
