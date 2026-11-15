// 個人情報の列の候補を選ぶ。選ぶのは候補だけで、最終判断はスチュワードが行う。

const NAME_KEYWORDS = [
  '氏名', '名前', 'フリガナ', 'ふりがな', 'カナ', 'メール', 'mail', '電話', 'tel', 'phone',
  '住所', 'address', '生年月日', '誕生日', 'birth', '緊急連絡先', '給与', '月給', '年収', '人事評価',
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 0から始まる、ハイフン区切りの番号か、10〜11桁の番号
const PHONE_PATTERN = /^0\d{1,4}-\d{1,4}-\d{3,4}$|^0\d{9,10}$/;

export type PiiReason = 'name' | 'email' | 'phone';

export function piiReasonLabel(reason: PiiReason): string {
  switch (reason) {
    case 'name':
      return '列名';
    case 'email':
      return 'メールアドレスの形の値';
    case 'phone':
      return '電話番号の形の値';
  }
}

export function matchesPiiName(columnName: string): boolean {
  const lower = columnName.toLowerCase();
  return NAME_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase()));
}

export function looksLikeEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

export function looksLikePhone(value: string): boolean {
  return PHONE_PATTERN.test(value.trim());
}

/** 列名と全行の値から、個人情報の列だと考えた理由を返す。候補でなければ空配列 */
export function detectPiiReasons(columnName: string, values: string[]): PiiReason[] {
  const reasons: PiiReason[] = [];
  if (matchesPiiName(columnName)) reasons.push('name');
  if (values.some(looksLikeEmail)) reasons.push('email');
  if (values.some(looksLikePhone)) reasons.push('phone');
  return reasons;
}
