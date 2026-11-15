// 列単位のメタデータ

import type { DatasetColumn } from '@/types/database';
import { COLUMN_SENSITIVITY_LABELS, DATA_TYPE_LABELS } from '@/lib/datasets/labels';
import { formatNumber, formatPercent } from '@/components/format';
import { Section } from './section';

export function ColumnTable({ columns }: { columns: DatasetColumn[] }) {
  return (
    <Section title="列" note={`${columns.length} 列`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 pr-3">#</th>
              <th className="py-1 pr-3">列名</th>
              <th className="py-1 pr-3">型</th>
              <th className="py-1 pr-3">説明</th>
              <th className="py-1 pr-3">機微度</th>
              <th className="py-1 pr-3">個人情報</th>
              <th className="py-1 pr-3 text-right">欠損率</th>
              <th className="py-1 text-right">ユニーク数</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {columns.map((c) => (
              <tr key={c.id} className="align-top">
                <td className="py-1.5 pr-3 text-slate-400 tabular-nums">{c.position}</td>
                <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{c.name}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{DATA_TYPE_LABELS[c.data_type]}</td>
                <td className="py-1.5 pr-3">{c.description ?? <span className="text-slate-400">—</span>}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {c.sensitivity ? COLUMN_SENSITIVITY_LABELS[c.sensitivity] : <span className="text-slate-400">未設定</span>}
                </td>
                <td className="py-1.5 pr-3">{c.is_pii ? '個人情報' : ''}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{formatPercent(c.null_rate)}</td>
                <td className="py-1.5 text-right tabular-nums">{formatNumber(c.distinct_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
