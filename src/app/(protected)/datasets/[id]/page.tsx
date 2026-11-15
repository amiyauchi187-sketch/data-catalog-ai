import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/require-user';
import {
  getChangeLogs,
  getColumnSamples,
  getColumns,
  getDataset,
  getProfiles,
  getTagsByDataset,
} from '@/lib/datasets/queries';
import { availableActions } from '@/lib/datasets/status';
import { buildSampleRows } from '@/lib/datasets/samples';
import { SensitivityBadges, StatusBadge, TagList } from '@/components/badges';
import { MetadataSections } from './metadata-sections';
import { ColumnTable } from './column-table';
import { SampleTable } from './sample-table';
import { ChangeLogList } from './change-log-list';
import { StatusActions } from './status-actions';

export default async function DatasetDetailPage(props: PageProps<'/datasets/[id]'>) {
  const { id } = await props.params;
  const user = await requireUser();

  // 閲覧者には公開中しか返らない（RLS）。見えなければ 404
  const dataset = await getDataset(id);
  if (!dataset) notFound();

  const [columns, tags, profiles, logs] = await Promise.all([
    getColumns(id),
    getTagsByDataset([id]),
    getProfiles(),
    user.isSteward ? getChangeLogs(id) : Promise.resolve([]),
  ]);
  const samples = await getColumnSamples(columns.map((c) => c.id));
  const sampleRows = buildSampleRows(dataset, columns, samples);
  const actions = availableActions(dataset, { userId: user.id, isSteward: user.isSteward });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/datasets" className="text-sm text-sky-700 hover:underline">
          ← 一覧へ
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{dataset.name}</h1>
          <StatusBadge status={dataset.status} />
          <SensitivityBadges values={dataset.sensitivity} />
        </div>
        <div className="mt-2">
          <TagList tags={tags.get(id) ?? []} />
        </div>
      </div>

      {user.isSteward && (
        <StatusActions
          datasetId={id}
          status={dataset.status}
          actions={actions}
          isSelfApprovalBlocked={dataset.status === 'pending_review' && !actions.includes('approve')}
        />
      )}

      <MetadataSections dataset={dataset} profiles={profiles} />
      <ColumnTable columns={columns} />
      <SampleTable columns={columns} rows={sampleRows} isSteward={user.isSteward} />
      {user.isSteward && <ChangeLogList logs={logs} profiles={profiles} />}
    </div>
  );
}
