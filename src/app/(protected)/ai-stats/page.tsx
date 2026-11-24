// AI提案の採用率（スチュワードだけ）。判断済みの提案だけを数える（未判断・置き換え済みは除く）

import { requireSteward } from '@/lib/auth/require-steward';
import { getSuggestionStats } from '@/lib/datasets/queries';
import { FIELD_LABELS } from '@/lib/datasets/labels';
import { computeAdoption, formatRate, sumCounts, type Counts } from '@/lib/ai/adoption';
import type { AiSuggestionStat } from '@/types/database';

function groupBy(stats: AiSuggestionStat[], keyOf: (s: AiSuggestionStat) => string): Map<string, Counts> {
  const groups = new Map<string, AiSuggestionStat[]>();
  for (const s of stats) groups.set(keyOf(s), [...(groups.get(keyOf(s)) ?? []), s]);
  return new Map([...groups].map(([key, rows]) => [key, sumCounts(rows)]));
}

function StatsTable({ title, rows }: { title: string; rows: [string, Counts][] }) {
  return (
    <section className="space-y-2">
      <h2 className="font-bold">{title}</h2>
      <table className="w-full rounded-lg border border-slate-200 bg-white text-sm">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="px-3 py-2"></th>
            <th className="px-3 py-2 text-right">判断済み</th>
            <th className="px-3 py-2 text-right">採用</th>
            <th className="px-3 py-2 text-right">修正して採用</th>
            <th className="px-3 py-2 text-right">却下</th>
            <th className="px-3 py-2 text-right">採用率</th>
            <th className="px-3 py-2 text-right">修正込み採用率</th>
            <th className="px-3 py-2 text-right">うちまとめて判断</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(([label, counts]) => {
            const a = computeAdoption(counts);
            return (
              <tr key={label}>
                <td className="px-3 py-1.5">{label}</td>
                <td className="px-3 py-1.5 text-right">{a.decided}</td>
                <td className="px-3 py-1.5 text-right">{a.accepted}</td>
                <td className="px-3 py-1.5 text-right">{a.modified}</td>
                <td className="px-3 py-1.5 text-right">{a.rejected}</td>
                <td className="px-3 py-1.5 text-right font-medium">{formatRate(a.acceptRate)}</td>
                <td className="px-3 py-1.5 text-right">{formatRate(a.acceptOrModifyRate)}</td>
                <td className="px-3 py-1.5 text-right text-slate-500">{a.decided_in_bulk}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export default async function AiStatsPage() {
  await requireSteward();
  const stats = await getSuggestionStats();

  const total: [string, Counts][] = [['すべて', sumCounts(stats)]];
  const byVersion = [...groupBy(stats, (s) => `${s.prompt_version}（${s.model}）`)];
  const byField = [...groupBy(stats, (s) => FIELD_LABELS[s.field] ?? s.field)];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">AI提案の採用率</h1>
      <p className="text-sm text-slate-600">
        採用率＝採用 ÷ 判断済み、修正込み採用率＝（採用＋修正して採用）÷ 判断済み。未判断の提案と、提案させ直して置き換えられた提案は数えません。
        「まとめて採用」した分も採用に含みます（件数は「うちまとめて判断」）。
      </p>
      {stats.length === 0 ? (
        <p className="text-sm text-slate-500">まだ判断済みの提案はありません。</p>
      ) : (
        <>
          <StatsTable title="全体" rows={total} />
          <StatsTable title="プロンプトの版・モデル別" rows={byVersion} />
          <StatsTable title="項目別" rows={byField} />
        </>
      )}
    </div>
  );
}
