// AI提案の採用率を計算する。判断済み（採用・修正・却下）だけを分母にする。

import type { AiSuggestionStat } from '../../types/database.ts';

export type Counts = Pick<AiSuggestionStat, 'accepted' | 'modified' | 'rejected' | 'decided_in_bulk'>;

export type Adoption = Counts & {
  decided: number;
  /** 採用 ÷ 判断済み。判断済みが0件なら null */
  acceptRate: number | null;
  /** (採用 + 修正) ÷ 判断済み */
  acceptOrModifyRate: number | null;
};

export function computeAdoption(c: Counts): Adoption {
  const decided = c.accepted + c.modified + c.rejected;
  return {
    ...c,
    decided,
    acceptRate: decided === 0 ? null : c.accepted / decided,
    acceptOrModifyRate: decided === 0 ? null : (c.accepted + c.modified) / decided,
  };
}

/** 行を足し合わせる（全体の合計や、項目ごとの合計に使う） */
export function sumCounts(rows: Counts[]): Counts {
  return rows.reduce<Counts>(
    (sum, r) => ({
      accepted: sum.accepted + r.accepted,
      modified: sum.modified + r.modified,
      rejected: sum.rejected + r.rejected,
      decided_in_bulk: sum.decided_in_bulk + r.decided_in_bulk,
    }),
    { accepted: 0, modified: 0, rejected: 0, decided_in_bulk: 0 },
  );
}

export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1)}%`;
}
