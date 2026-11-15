import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCsvBytes } from '../../src/lib/csv/decode.ts';
import { parseCsvText, toCsvTable } from '../../src/lib/csv/parse.ts';
import { inferDataType, isValidDate, profileColumn, roundRate } from '../../src/lib/csv/profile.ts';
import { detectPiiReasons } from '../../src/lib/csv/detect-pii.ts';
import { maskSamples } from '../../src/lib/csv/mask.ts';
import { analyzeCsv } from '../../src/lib/csv/analyze.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);

// 「店舗」を Shift_JIS にしたバイト列
const SJIS_TENPO = [0x93, 0x58, 0x95, 0xdc];

test('UTF-8 と BOM付きUTF-8 を読める', () => {
  assert.deepEqual(decodeCsvBytes(utf8('a,b\n')), { text: 'a,b\n', encoding: 'utf-8' });
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('列\n')]);
  assert.deepEqual(decodeCsvBytes(withBom), { text: '列\n', encoding: 'utf-8' });
});

test('Shift_JIS を読める', () => {
  const buf = new Uint8Array([...SJIS_TENPO, 0x0a]);
  assert.deepEqual(decodeCsvBytes(buf), { text: '店舗\n', encoding: 'shift_jis' });
});

test('UTF-16 は対応していないとエラーにする', () => {
  assert.throws(() => decodeCsvBytes(new Uint8Array([0xff, 0xfe, 0x41, 0x00])), /UTF-16/);
});

test('引用符・引用符内のカンマと改行・CRLF を解析できる', () => {
  assert.deepEqual(parseCsvText('a,"b,c","d\r\ne"\r\n1,"x""y",\r\n'), [
    ['a', 'b,c', 'd\r\ne'],
    ['1', 'x"y', ''],
  ]);
});

test('引用符が閉じていなければエラー', () => {
  assert.throws(() => parseCsvText('a,"b\n'), /引用符/);
});

test('壊れたCSVはエラーにする', () => {
  assert.throws(() => toCsvTable(''), /空です/);
  assert.throws(() => toCsvTable('\n\n'), /空です/);
  assert.throws(() => toCsvTable('id,name\n'), /ヘッダーだけ/);
  assert.throws(() => toCsvTable('id,name\n1,a\n2\n'), /3行目の列数/);
  assert.throws(() => toCsvTable('id,id\n1,2\n'), /重複/);
  assert.throws(() => toCsvTable('id,\n1,2\n'), /2列目の列名が空/);
});

test('空行は読み飛ばし、列名の前後の空白は除く', () => {
  assert.deepEqual(toCsvTable(' id , name \n1,a\n\n2,b\n'), {
    header: ['id', 'name'],
    rows: [['1', 'a'], ['2', 'b']],
  });
});

test('型を推定する', () => {
  assert.equal(inferDataType(['1', '-2', '']), 'integer');
  assert.equal(inferDataType(['1', '2.5']), 'decimal');
  assert.equal(inferDataType(['2026-01-31', '2026/2/1']), 'date');
  assert.equal(inferDataType(['true', 'FALSE']), 'boolean');
  assert.equal(inferDataType(['0001', 'A-01']), 'text');
  assert.equal(inferDataType(['', ' ']), 'text');
  assert.equal(isValidDate('2026-02-30'), false);
});

test('欠損数・欠損率・ユニーク数・サンプルを計算する', () => {
  const values = ['a', '', 'b', 'a', ' ', 'c', 'd'];
  assert.deepEqual(profileColumn('列', 1, values), {
    position: 1,
    name: '列',
    dataType: 'text',
    nullCount: 2,
    nullRate: 0.2857,
    distinctCount: 4,
    samples: ['a', null, 'b', 'a', null],
  });
  assert.equal(roundRate(0, 0), 0);
});

test('個人情報の列の候補を、列名と値の形から選ぶ', () => {
  assert.deepEqual(detectPiiReasons('氏名', ['架空 太郎']), ['name']);
  assert.deepEqual(detectPiiReasons('連絡先', ['なし', 'taro@example.com']), ['email']);
  assert.deepEqual(detectPiiReasons('備考', ['000-0000-1234']), ['phone']);
  assert.deepEqual(detectPiiReasons('商品ID', ['P0001', '0001']), []);
});

test('伏せるときは null と空文字を残す', () => {
  assert.deepEqual(maskSamples(['a', null, '', 'b']), ['***', null, '', '***']);
});

test('analyzeCsv がまとめて読み取る', () => {
  const result = analyzeCsv(utf8('顧客ID,メール\nC1,a@example.com\nC2,\n'));
  assert.equal(result.encoding, 'utf-8');
  assert.equal(result.rowCount, 2);
  assert.deepEqual(result.columns.map((c) => c.piiReasons), [[], ['name', 'email']]);
  assert.deepEqual(result.columns[1].samples, ['a@example.com', null]);
});
