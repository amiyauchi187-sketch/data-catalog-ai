// フォームで共通に使う部品

import type { ReactNode } from 'react';

export type ActionState = { errors: string[] } | null;

export function ErrorList({ state }: { state: ActionState }) {
  if (!state || state.errors.length === 0) return null;
  return (
    <ul role="alert" className="rounded border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-800">
      {state.errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500';

export const buttonClass =
  'inline-flex items-center rounded bg-sky-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50';

export const subButtonClass =
  'inline-flex items-center rounded border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50';

export const dangerButtonClass =
  'inline-flex items-center rounded border border-rose-300 bg-white px-4 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50';
