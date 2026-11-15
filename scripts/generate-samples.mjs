// 架空の会社「サンプルリテール株式会社」のサンプルCSVを samples/ に生成する。
// 乱数のシードを固定しているので、何度実行しても同じCSVができる。追加パッケージは使わない。
//
// 実在のものに当たらないようにする：
// - 氏名は名字と名前のリストをランダムに組み合わせる
// - メールは予約済みドメイン example.com だけ
// - 電話番号は 000 から始まる、割り当てられない番号
// - 住所は郵便番号 000-XXXX、「サンプル市見本町」のような架空の地名

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(import.meta.dirname, '..', 'samples');

// ---- 乱数（mulberry32） ----

function createRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(20261109);
const int = (min, max) => min + Math.floor(random() * (max - min + 1));
const pick = (list) => list[Math.floor(random() * list.length)];
const chance = (p) => random() < p;
const pad = (n, width) => String(n).padStart(width, '0');

function dateBetween(start, end) {
  const s = Date.UTC(...start);
  const e = Date.UTC(...end);
  const d = new Date(s + Math.floor(random() * (e - s)));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

// ---- CSV ----

function quote(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n';
}

// ---- Shift_JIS への変換（TextDecoder で逆引き表を作る） ----

function buildShiftJisTable() {
  const decoder = new TextDecoder('shift_jis');
  const table = new Map();
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    if (lead > 0x9f && lead < 0xe0) continue;
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      const ch = decoder.decode(new Uint8Array([lead, trail]));
      if (ch.length === 1 && ch !== '�' && !table.has(ch)) table.set(ch, [lead, trail]);
    }
  }
  return table;
}

function encodeShiftJis(text) {
  const table = buildShiftJisTable();
  const bytes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 0x80) bytes.push(code);
    else if (table.has(ch)) bytes.push(...table.get(ch));
    else throw new Error(`Shift_JIS に変換できない文字があります: ${ch}`);
  }
  return new Uint8Array(bytes);
}

// ---- 架空の名前 ----

const FAMILY = [
  ['佐藤', 'サトウ'], ['鈴木', 'スズキ'], ['高橋', 'タカハシ'], ['田中', 'タナカ'], ['伊藤', 'イトウ'],
  ['渡辺', 'ワタナベ'], ['山本', 'ヤマモト'], ['中村', 'ナカムラ'], ['小林', 'コバヤシ'], ['加藤', 'カトウ'],
  ['吉田', 'ヨシダ'], ['山田', 'ヤマダ'], ['松本', 'マツモト'], ['井上', 'イノウエ'], ['木村', 'キムラ'],
  ['林', 'ハヤシ'], ['清水', 'シミズ'], ['森', 'モリ'], ['池田', 'イケダ'], ['橋本', 'ハシモト'],
];
const GIVEN = [
  ['陽菜', 'ヒナ'], ['結衣', 'ユイ'], ['美咲', 'ミサキ'], ['葵', 'アオイ'], ['さくら', 'サクラ'],
  ['蓮', 'レン'], ['悠真', 'ユウマ'], ['湊', 'ミナト'], ['大翔', 'ヒロト'], ['陽太', 'ヨウタ'],
  ['健一', 'ケンイチ'], ['直樹', 'ナオキ'], ['由美', 'ユミ'], ['恵子', 'ケイコ'], ['翔太', 'ショウタ'],
  ['真央', 'マオ'], ['拓海', 'タクミ'], ['彩', 'アヤ'], ['優子', 'ユウコ'], ['誠', 'マコト'],
];

function personName() {
  const [f, fk] = pick(FAMILY);
  const [g, gk] = pick(GIVEN);
  return { name: `${f} ${g}`, kana: `${fk} ${gk}` };
}

const fakePhone = (n) => `000-0000-${pad(n, 4)}`;

const PREFECTURES = [
  ['北海道', '北海道'], ['宮城県', '東北'], ['東京都', '関東'], ['神奈川県', '関東'], ['埼玉県', '関東'],
  ['千葉県', '関東'], ['愛知県', '中部'], ['静岡県', '中部'], ['大阪府', '近畿'], ['京都府', '近畿'],
  ['兵庫県', '近畿'], ['広島県', '中国'], ['香川県', '四国'], ['福岡県', '九州'], ['沖縄県', '九州'],
];

// ---- 商品（公開） ----

const CATEGORIES = {
  食品: ['見本パスタ', 'サンプル米 5kg', 'ためしカレー', '見本ドレッシング', 'サンプル味噌'],
  飲料: ['見本ブレンドコーヒー', 'サンプル緑茶', 'ためし炭酸水', '見本果汁100%'],
  日用品: ['サンプル洗剤', '見本ティッシュ', 'ためしハンドソープ', '見本ラップ'],
  衣料: ['見本Tシャツ', 'サンプル靴下', 'ためしタオル'],
  家電: ['サンプル電気ケトル', '見本ドライヤー', 'ためしLEDライト'],
};

function generateProducts() {
  const rows = [];
  for (let i = 1; i <= 100; i++) {
    const category = pick(Object.keys(CATEGORIES));
    const base = pick(CATEGORIES[category]);
    const price = category === '家電' ? int(20, 120) * 100 : int(1, 30) * 50 + 48;
    const released = dateBetween([2019, 0, 1], [2026, 6, 1]);
    const ended = chance(0.15) ? dateBetween([2026, 6, 1], [2027, 11, 31]) : '';
    rows.push([`P${pad(i, 4)}`, `${base} ${String.fromCharCode(65 + (i % 26))}${i}`, category, price, released, ended]);
  }
  return { header: ['商品ID', '商品名', 'カテゴリ', '価格', '発売日', '販売終了日'], rows };
}

// ---- 店舗（社内、Shift_JIS） ----

const TOWNS = ['みどり台', 'さくら坂', 'ひかり野', 'あおば丘', 'こもれび', 'ほしの里', 'わかば', 'かえで通り', 'つばさ台', 'しらゆり'];
const FORMATS = ['スーパー', 'ミニ', '郊外大型'];

function generateStores() {
  const rows = [];
  for (let i = 1; i <= 20; i++) {
    const [pref, region] = pick(PREFECTURES);
    const format = pick(FORMATS);
    const area = format === '郊外大型' ? int(2500, 5000) : format === 'スーパー' ? int(1000, 2500) : int(150, 400);
    const renovation = chance(0.3) ? dateBetween([2027, 0, 1], [2028, 11, 31]) : '';
    rows.push([
      `S${pad(i, 3)}`, `サンプルリテール ${TOWNS[i % TOWNS.length]}${i}号店`, region, pref, format,
      dateBetween([2005, 0, 1], [2025, 11, 31]), area, Math.round(area / 60) + int(3, 10), renovation,
    ]);
  }
  return {
    header: ['店舗ID', '店舗名', '地域', '都道府県', '業態', '開店日', '売場面積', '従業員数', '改装予定日'],
    rows,
  };
}

// ---- 顧客（個人情報を含む） ----

const RANKS = ['ブロンズ', 'シルバー', 'ゴールド'];

function generateCustomers() {
  const rows = [];
  for (let i = 1; i <= 500; i++) {
    const { name, kana } = personName();
    const registered = dateBetween([2018, 0, 1], [2026, 9, 1]);
    const left = chance(0.08) ? dateBetween([2026, 0, 1], [2026, 10, 1]) : '';
    rows.push([
      `C${pad(i, 5)}`, name, kana, `customer${pad(i, 5)}@example.com`, fakePhone(i),
      dateBetween([1950, 0, 1], [2006, 11, 31]), pick(PREFECTURES)[0], pick(RANKS), registered, left,
    ]);
  }
  return {
    header: ['顧客ID', '氏名', 'フリガナ', 'メール', '電話番号', '生年月日', '居住地域', '会員ランク', '登録日', '退会日'],
    rows,
  };
}

// ---- 注文（機密） ----

const PAYMENTS = ['現金', 'クレジットカード', '電子マネー', 'QRコード決済'];

function generateOrders(products, stores, customers) {
  const rows = [];
  for (let i = 1; i <= 3000; i++) {
    const product = pick(products.rows);
    const quantity = int(1, 5);
    const unitPrice = product[3];
    const discount = chance(0.2) ? int(1, 5) * 10 : '';
    const sales = unitPrice * quantity - (discount || 0);
    rows.push([
      `O${pad(i, 6)}`, dateBetween([2026, 0, 1], [2026, 9, 31]), pick(customers.rows)[0], pick(stores.rows)[0],
      product[0], quantity, unitPrice, discount, sales, Math.round(sales * (0.15 + random() * 0.2)), pick(PAYMENTS),
    ]);
  }
  return {
    header: ['注文ID', '注文日', '顧客ID', '店舗ID', '商品ID', '数量', '単価', '割引額', '売上金額', '粗利額', '支払方法'],
    rows,
  };
}

// ---- 従業員（個人情報を含む＋機密） ----

const POSITIONS = ['店長', '副店長', 'チーフ', 'スタッフ', 'スタッフ', 'スタッフ'];
const EVALUATIONS = ['S', 'A', 'B', 'B', 'C'];

function generateEmployees(stores) {
  const rows = [];
  for (let i = 1; i <= 50; i++) {
    const { name, kana } = personName();
    const position = pick(POSITIONS);
    const salary = { 店長: int(42, 55), 副店長: int(34, 42), チーフ: int(28, 34), スタッフ: int(21, 28) }[position] * 10000;
    const emergency = chance(0.2) ? '' : fakePhone(5000 + i);
    rows.push([
      `E${pad(i, 4)}`, name, kana, `staff${pad(i, 4)}@example.com`, fakePhone(1000 + i),
      `〒000-${pad(int(0, 9999), 4)} サンプル市見本町${int(1, 9)}-${int(1, 20)}-${int(1, 30)}`,
      dateBetween([1965, 0, 1], [2004, 11, 31]), dateBetween([2005, 3, 1], [2026, 3, 1]),
      pick(stores.rows)[0], position, salary, pick(EVALUATIONS), emergency,
    ]);
  }
  return {
    header: ['従業員ID', '氏名', 'フリガナ', 'メール', '電話番号', '住所', '生年月日', '入社日', '所属店舗ID', '役職', '給与', '人事評価', '緊急連絡先'],
    rows,
  };
}

// ---- 出力 ----

function writeUtf8(fileName, table) {
  writeFileSync(join(OUT_DIR, fileName), toCsv(table.header, table.rows), 'utf8');
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const products = generateProducts();
  const stores = generateStores();
  const customers = generateCustomers();
  const orders = generateOrders(products, stores, customers);
  const employees = generateEmployees(stores);

  writeUtf8('products.csv', products);
  writeFileSync(join(OUT_DIR, 'stores.csv'), encodeShiftJis(toCsv(stores.header, stores.rows)));
  writeUtf8('customers.csv', customers);
  writeUtf8('orders.csv', orders);
  writeUtf8('employees.csv', employees);
  console.log(`サンプルCSVを ${OUT_DIR} に出力しました`);
}

main();
