// 変更履歴（スチュワードだけ）

import type { ChangeLog, Profile } from '@/types/database';
import { describeAiDecision, describeLogValue } from '@/lib/datasets/change-log-format';
import { FIELD_LABELS } from '@/lib/datasets/labels';
import { formatDateTime } from '@/components/format';
import { Section } from './section';

export function ChangeLogList({ logs, profiles }: { logs: ChangeLog[]; profiles: Map<string, Profile> }) {
  return (
    <Section title="変更履歴" note="スチュワードだけに表示">
      {logs.length === 0 ? (
        <p className="text-sm text-slate-500">履歴はありません</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 pr-3">日時</th>
              <th className="py-1 pr-3">変更者</th>
              <th className="py-1 pr-3">項目</th>
              <th className="py-1 pr-3">変更前</th>
              <th className="py-1 pr-3">変更後</th>
              <th className="py-1">AI提案・理由</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((log) => (
              <tr key={log.id} className="align-top">
                <td className="py-1.5 pr-3 whitespace-nowrap">{formatDateTime(log.changed_at)}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {log.changed_by ? (profiles.get(log.changed_by)?.display_name ?? '（不明）') : '（SQLで変更）'}
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {log.column_name && <span className="text-slate-500">{log.column_name}：</span>}
                  {FIELD_LABELS[log.field] ?? log.field}
                </td>
                <td className="py-1.5 pr-3 text-slate-500">{describeLogValue(log.field, log.old_value, profiles)}</td>
                <td className="py-1.5 pr-3">{describeLogValue(log.field, log.new_value, profiles)}</td>
                <td className="py-1.5">
                  <AiDecisionNote log={log} profiles={profiles} />
                  {log.note ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function AiDecisionNote({ log, profiles }: { log: ChangeLog; profiles: Map<string, Profile> }) {
  const text = describeAiDecision(log, profiles);
  if (!text) return null;
  return <span className="mr-2 rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-800">{text}</span>;
}
