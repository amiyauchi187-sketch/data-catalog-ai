import Link from 'next/link';
import { requireUser } from '@/lib/auth/require-user';
import { getTagsByDataset, searchDatasets } from '@/lib/datasets/queries';
import { parseSearchFilters, type SearchFilters } from '@/lib/datasets/search-params';
import { DOMAIN_LABELS, SENSITIVITY_LABELS, STATUS_LABELS, keysOf } from '@/lib/datasets/labels';
import { SensitivityBadges, StatusBadge, TagList } from '@/components/badges';
import { buttonClass, inputClass, subButtonClass } from '@/components/form-parts';
import { formatDate, formatNumber } from '@/components/format';
import type { Dataset } from '@/types/database';

export default async function DatasetsPage(props: PageProps<'/datasets'>) {
  const user = await requireUser();
  const filters = parseSearchFilters(await props.searchParams);
  const datasets = await searchDatasets(filters);
  const tags = await getTagsByDataset(datasets.map((d) => d.id));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">データセット</h1>
        {user.isSteward && (
          <Link href="/datasets/new" className={buttonClass}>
            CSVを登録
          </Link>
        )}
      </div>
      <SearchForm filters={filters} showStatus={user.isSteward} />
      <p className="text-sm text-slate-500">{datasets.length} 件</p>
      <DatasetTable datasets={datasets} tags={tags} />
    </div>
  );
}

function CheckboxGroup<T extends string>(props: {
  name: string;
  legend: string;
  labels: Record<T, string>;
  selected: T[];
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <legend className="sr-only">{props.legend}</legend>
      <span className="w-16 text-slate-500">{props.legend}</span>
      {keysOf(props.labels).map((key) => (
        <label key={key} className="inline-flex items-center gap-1">
          <input type="checkbox" name={props.name} value={key} defaultChecked={props.selected.includes(key)} />
          {props.labels[key]}
        </label>
      ))}
    </fieldset>
  );
}

function SearchForm({ filters, showStatus }: { filters: SearchFilters; showStatus: boolean }) {
  return (
    <form className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" role="search">
      <div className="flex gap-2">
        <input
          name="q"
          defaultValue={filters.q}
          placeholder="名称・説明・タグ・列名で検索"
          className={inputClass}
          aria-label="キーワード"
        />
        <button type="submit" className={buttonClass}>
          検索
        </button>
        <Link href="/datasets" className={subButtonClass}>
          クリア
        </Link>
      </div>
      <CheckboxGroup name="domain" legend="ドメイン" labels={DOMAIN_LABELS} selected={filters.domains} />
      <CheckboxGroup name="sensitivity" legend="機微度" labels={SENSITIVITY_LABELS} selected={filters.sensitivities} />
      {showStatus && (
        <CheckboxGroup name="status" legend="状態" labels={STATUS_LABELS} selected={filters.statuses} />
      )}
    </form>
  );
}

function DatasetTable({ datasets, tags }: { datasets: Dataset[]; tags: Map<string, string[]> }) {
  if (datasets.length === 0) {
    return <p className="rounded border border-dashed border-slate-300 p-8 text-center text-slate-500">該当するデータセットはありません</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-600">
          <tr>
            <th className="px-4 py-2">名称</th>
            <th className="px-4 py-2">ドメイン</th>
            <th className="px-4 py-2">機微度</th>
            <th className="px-4 py-2">状態</th>
            <th className="px-4 py-2 text-right">件数</th>
            <th className="px-4 py-2">更新日</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {datasets.map((d) => (
            <tr key={d.id} className="align-top">
              <td className="px-4 py-2">
                <Link href={`/datasets/${d.id}`} className="font-medium text-sky-700 hover:underline">
                  {d.name}
                </Link>
                {d.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{d.description}</p>}
                <div className="mt-1">
                  <TagList tags={tags.get(d.id) ?? []} />
                </div>
              </td>
              <td className="px-4 py-2 whitespace-nowrap">{d.domain ? DOMAIN_LABELS[d.domain] : '—'}</td>
              <td className="px-4 py-2">
                <SensitivityBadges values={d.sensitivity} />
              </td>
              <td className="px-4 py-2">
                <StatusBadge status={d.status} />
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{formatNumber(d.row_count)}</td>
              <td className="px-4 py-2 whitespace-nowrap">{formatDate(d.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
