import type { ReactNode } from 'react';

export function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-2">
        <h2 className="font-semibold">{title}</h2>
        {note && <span className="text-xs text-slate-500">{note}</span>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function DefinitionList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-slate-500">{label}</dt>
          <dd className="whitespace-pre-wrap">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
