// 公開中のデータセットが、定義（dev-datasets.ts）と機微度・個人情報の指定で食い違っていないかを調べる。
// 食い違いは、閲覧者に何が見えるか（RLS）に関わるので、シードのスクリプトが普通の手順で直す。
// 説明やタグの違いは見ない（人が画面で直した内容を上書きしないため）。

import type { ColumnSensitivity, Sensitivity } from '../src/types/database.ts';
import type { DatasetSpec } from './dev-datasets.ts';

export type CurrentDataset = {
  sensitivity: Sensitivity[];
  columns: { name: string; sensitivity: ColumnSensitivity | null; is_pii: boolean }[];
};

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
}

/** 食い違いを日本語の文で返す。空なら定義どおり */
export function findSensitivityDiffs(spec: DatasetSpec, current: CurrentDataset): string[] {
  const diffs: string[] = [];
  if (!sameSet(spec.sensitivity, current.sensitivity)) {
    diffs.push(`データセットの機微度：${current.sensitivity.join('＋') || '未設定'} → ${spec.sensitivity.join('＋')}`);
  }
  for (const col of current.columns) {
    const columnSpec = spec.columns[col.name];
    if (!columnSpec) continue;
    if (col.sensitivity !== columnSpec.sensitivity) {
      diffs.push(`列「${col.name}」の機微度：${col.sensitivity ?? '未設定'} → ${columnSpec.sensitivity}`);
    }
    const shouldBePii = spec.pii.includes(col.name);
    if (col.is_pii !== shouldBePii) {
      diffs.push(`列「${col.name}」の個人情報の指定：${col.is_pii ? 'あり' : 'なし'} → ${shouldBePii ? 'あり' : 'なし'}`);
    }
  }
  return diffs;
}
