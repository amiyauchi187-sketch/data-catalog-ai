// サンプル値。RLSで取れなかった列は「非表示」と出す

import type { DatasetColumn } from '@/types/database';
import { hasVisibleSamples, hiddenReasonLabel, type SampleCell } from '@/lib/datasets/samples';
import { Section } from './section';

function Cell({ cell }: { cell: SampleCell }) {
  if (cell.kind === 'hidden') return <span className="text-xs text-slate-400">{hiddenReasonLabel(cell.reason)}</span>;
  if (cell.value === null) return <span className="text-slate-300">(空)</span>;
  return <>{cell.value}</>;
}

export function SampleTable(props: { columns: DatasetColumn[]; rows: SampleCell[][]; isSteward: boolean }) {
  const note = props.isSteward
    ? '個人情報の列は保存時に *** に伏せています'
    : '機微度に応じて、一部またはすべての列を非表示にしています';

  return (
    <Section title={`サンプル（先頭 ${props.rows.length} 行）`} note={note}>
      {props.rows.length === 0 ? (
        <p className="text-sm text-slate-500">サンプルはありません</p>
      ) : (
        <>
          {!hasVisibleSamples(props.rows) && (
            <p className="mb-2 text-sm text-slate-500">このデータセットのサンプルは表示できません。</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  {props.columns.map((c) => (
                    <th key={c.id} className="py-1 pr-4 whitespace-nowrap">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {props.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={props.columns[j].id} className="py-1.5 pr-4 whitespace-nowrap">
                        <Cell cell={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}
