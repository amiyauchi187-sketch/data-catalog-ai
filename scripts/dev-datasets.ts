// 開発用DBに公開しておく、サンプルCSVの5つのデータセットの内容（すべて架空）。
// 説明やタグは、現場のスチュワードが書きそうな程度にとどめる。評価（eval/qa-cases.json）の質問の言葉を
// わざと詰め込まない（「探す」部分の力を正しく測るため）。
// 機微度は docs/requirements.md の「主なデータ」の表に合わせる（顧客＝個人情報を含む、注文＝機密、従業員＝個人情報を含む＋機密など）。

import type { ColumnSensitivity, Domain, Sensitivity, UpdateFrequency } from '../src/types/database.ts';

export type ColumnSpec = { sensitivity: ColumnSensitivity; description?: string };

export type DatasetSpec = {
  name: string;
  /** 以前の名前。見つかったら、この名前に直す */
  legacyNames: string[];
  file: string;
  domain: Domain;
  sensitivity: Sensitivity[];
  description: string;
  tags: string[];
  owner_name: string;
  source_system: string;
  update_frequency: UpdateFrequency;
  usage_notes: string | null;
  /** 個人情報の列（登録するときに指定する） */
  pii: string[];
  /** 列ごとの機微度と説明。CSVのすべての列を書く */
  columns: Record<string, ColumnSpec>;
};

const internal: ColumnSpec = { sensitivity: 'internal' };
const confidential: ColumnSpec = { sensitivity: 'confidential' };
const open: ColumnSpec = { sensitivity: 'public' };

export const DEV_DATASETS: DatasetSpec[] = [
  {
    name: '顧客',
    legacyNames: ['customers'],
    file: 'customers.csv',
    domain: 'customer',
    // 要件どおり「個人情報を含む」だけにする（閲覧者には個人情報の列だけが隠れる）。
    // 「機密」を付けるとデータセット全体が隠れるので付けない。個人情報の列は is_pii で隠れるため、列の機微度は「社内」でよい
    sensitivity: ['personal'],
    description: '会員登録した顧客のマスタ。1行が1会員。退会した会員も退会日を入れて残している。',
    tags: ['会員', 'マスタ'],
    owner_name: 'CRM推進部',
    source_system: '会員管理システム',
    update_frequency: 'daily',
    usage_notes: '氏名・連絡先などの個人情報を含む。販促以外の目的で使うときは、個人情報保護の担当に相談すること。',
    pii: ['氏名', 'フリガナ', 'メール', '電話番号', '生年月日'],
    columns: {
      顧客ID: internal,
      氏名: internal,
      フリガナ: internal,
      メール: internal,
      電話番号: internal,
      生年月日: internal,
      居住地域: { sensitivity: 'internal', description: '都道府県' },
      会員ランク: { sensitivity: 'internal', description: 'ブロンズ／シルバー／ゴールド。毎年4月に見直す' },
      登録日: internal,
      退会日: { sensitivity: 'internal', description: '在籍中は空' },
    },
  },
  {
    name: '注文',
    legacyNames: ['orders'],
    file: 'orders.csv',
    domain: 'sales',
    sensitivity: ['confidential'],
    description: 'POSの明細を日次で取り込んだもの。2026年1月〜10月分。1行が1注文で、商品は1注文に1種類。金額は税込。',
    tags: ['POS', '明細'],
    owner_name: '営業企画部',
    source_system: 'POS',
    update_frequency: 'daily',
    usage_notes: '粗利額と割引額は社外秘。部署の外に出すときは営業企画部に確認すること。',
    pii: [],
    columns: {
      注文ID: internal,
      注文日: internal,
      顧客ID: { sensitivity: 'internal', description: '会員でない客は「顧客」にない番号のことがある' },
      店舗ID: internal,
      商品ID: internal,
      数量: internal,
      単価: internal,
      割引額: { sensitivity: 'confidential', description: 'クーポンなどの値引き。値引きなしは空' },
      売上金額: { sensitivity: 'internal', description: '単価×数量−割引額' },
      粗利額: { sensitivity: 'confidential', description: '売上金額−原価' },
      支払方法: internal,
    },
  },
  {
    name: '商品',
    legacyNames: ['products'],
    file: 'products.csv',
    domain: 'product',
    sensitivity: ['public'],
    description: '取り扱い商品のマスタ。販売を終えた商品も残している。',
    tags: ['マスタ'],
    owner_name: '商品部',
    source_system: '商品マスタ管理',
    update_frequency: 'weekly',
    usage_notes: null,
    pii: [],
    columns: {
      商品ID: open,
      商品名: open,
      カテゴリ: { sensitivity: 'public', description: '大分類（食品、飲料、日用品、衣料、家電）' },
      価格: { sensitivity: 'public', description: '現在の税込売価' },
      発売日: open,
      販売終了日: { sensitivity: 'public', description: '販売中は空' },
    },
  },
  {
    name: '店舗',
    legacyNames: ['stores'],
    file: 'stores.csv',
    domain: 'store',
    sensitivity: ['internal'],
    description: '全店舗の基本情報（20店舗）。店舗台帳から月に1回書き出している。',
    tags: ['マスタ'],
    owner_name: '店舗運営部',
    source_system: '店舗台帳（Excel）',
    update_frequency: 'monthly',
    usage_notes: '従業員数は月初の在籍人数。',
    pii: [],
    columns: {
      店舗ID: internal,
      店舗名: internal,
      地域: internal,
      都道府県: internal,
      業態: { sensitivity: 'internal', description: 'スーパー／ミニ／郊外大型' },
      開店日: internal,
      売場面積: { sensitivity: 'internal', description: '単位は㎡' },
      従業員数: internal,
      改装予定日: { sensitivity: 'internal', description: '予定がなければ空' },
    },
  },
  {
    name: '従業員',
    legacyNames: ['employees'],
    file: 'employees.csv',
    domain: 'hr',
    sensitivity: ['confidential', 'personal'],
    description: '店舗に所属する従業員の一覧。人事システムから月次で書き出したもの。',
    tags: ['人事'],
    owner_name: '人事部',
    source_system: '人事システム',
    update_frequency: 'monthly',
    usage_notes: '給与・人事評価を含む。人事部の了承なしに使わないこと。',
    pii: ['氏名', 'フリガナ', 'メール', '電話番号', '住所', '生年月日', '緊急連絡先'],
    columns: {
      従業員ID: internal,
      氏名: confidential,
      フリガナ: confidential,
      メール: confidential,
      電話番号: confidential,
      住所: confidential,
      生年月日: confidential,
      入社日: internal,
      所属店舗ID: internal,
      役職: internal,
      給与: { sensitivity: 'confidential', description: '月額の基本給' },
      人事評価: { sensitivity: 'confidential', description: '前年度の評価（S／A／B／C）' },
      緊急連絡先: confidential,
    },
  },
];
