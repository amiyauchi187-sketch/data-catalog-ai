// 状態・機微度・タグの表示

import type { DatasetStatus, Sensitivity } from '@/types/database';
import { SENSITIVITY_LABELS, STATUS_LABELS } from '@/lib/datasets/labels';

const STATUS_STYLES: Record<DatasetStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 ring-slate-300',
  pending_review: 'bg-amber-50 text-amber-800 ring-amber-300',
  published: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  retired: 'bg-zinc-200 text-zinc-600 ring-zinc-300',
};

const SENSITIVITY_STYLES: Record<Sensitivity, string> = {
  public: 'bg-sky-50 text-sky-800 ring-sky-200',
  internal: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  confidential: 'bg-rose-50 text-rose-800 ring-rose-200',
  personal: 'bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200',
};

const BASE = 'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap';

export function StatusBadge({ status }: { status: DatasetStatus }) {
  return <span className={`${BASE} ${STATUS_STYLES[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function SensitivityBadges({ values }: { values: Sensitivity[] }) {
  if (values.length === 0) return <span className="text-xs text-slate-400">未設定</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {values.map((v) => (
        <span key={v} className={`${BASE} ${SENSITIVITY_STYLES[v]}`}>
          {SENSITIVITY_LABELS[v]}
        </span>
      ))}
    </span>
  );
}

export function TagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
          #{t}
        </span>
      ))}
    </span>
  );
}
