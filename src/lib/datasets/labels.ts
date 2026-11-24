// 画面に出す日本語の表示名

import type {
  ColumnSensitivity,
  DataType,
  DatasetStatus,
  Domain,
  Sensitivity,
  UpdateFrequency,
} from '../../types/database.ts';

export const DOMAIN_LABELS: Record<Domain, string> = {
  customer: '顧客',
  sales: '販売',
  product: '商品',
  store: '店舗',
  hr: '人事',
};

export const SENSITIVITY_LABELS: Record<Sensitivity, string> = {
  public: '公開',
  internal: '社内',
  confidential: '機密',
  personal: '個人情報を含む',
};

export const COLUMN_SENSITIVITY_LABELS: Record<ColumnSensitivity, string> = {
  public: '公開',
  internal: '社内',
  confidential: '機密',
};

export const STATUS_LABELS: Record<DatasetStatus, string> = {
  draft: '下書き',
  pending_review: '承認待ち',
  published: '公開中',
  retired: '廃止',
};

export const UPDATE_FREQUENCY_LABELS: Record<UpdateFrequency, string> = {
  daily: '日次',
  weekly: '週次',
  monthly: '月次',
  quarterly: '四半期',
  yearly: '年次',
  irregular: '不定期',
  none: '更新なし',
};

export const DATA_TYPE_LABELS: Record<DataType, string> = {
  integer: '整数',
  decimal: '数値',
  date: '日付',
  boolean: '真偽値',
  text: '文字列',
};

export const ENCODING_LABELS: Record<'utf-8' | 'shift_jis', string> = {
  'utf-8': 'UTF-8',
  shift_jis: 'Shift_JIS',
};

/** 変更履歴の項目名 */
export const FIELD_LABELS: Record<string, string> = {
  created: '登録',
  name: '名称',
  description: '説明',
  domain: 'データドメイン',
  sensitivity: '機微度',
  owner_name: 'データオーナー',
  steward_id: '担当スチュワード',
  usage_notes: '利用上の注意',
  source_system: '出所',
  update_frequency: '更新頻度',
  status: '状態',
  tags: '業務用語タグ',
  'column.description': '列の説明',
  'column.sensitivity': '列の機微度',
  'column.is_pii': '個人情報',
  'column.sample_masked': 'サンプルを伏せた',
  ai_suggested: 'AI提案を作成',
};

/** AI提案の判断結果 */
export const AI_DECISION_LABELS: Record<'accepted' | 'modified' | 'rejected', string> = {
  accepted: '採用',
  modified: '修正して採用',
  rejected: '却下',
};

/** データセット名の欄に出す注意書き（名称はAIに送られるため） */
export const DATASET_NAME_NOTICE =
  '機密情報（顧客名・個人名・取引先名など）を含めないでください。名称はAIの提案のために送られます';

export function sensitivityText(values: Sensitivity[]): string {
  if (values.length === 0) return '未設定';
  return values.map((v) => SENSITIVITY_LABELS[v]).join('＋');
}

export function keysOf<T extends string>(record: Record<T, string>): T[] {
  return Object.keys(record) as T[];
}
