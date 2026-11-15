import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSteward } from '@/lib/auth/require-steward';
import { getColumns, getDataset, getProfiles, getTagsByDataset } from '@/lib/datasets/queries';
import { EditForm } from './edit-form';

export default async function EditDatasetPage(props: PageProps<'/datasets/[id]/edit'>) {
  const { id } = await props.params;
  await requireSteward();

  const dataset = await getDataset(id);
  if (!dataset) notFound();

  if (dataset.status !== 'draft') {
    return (
      <div className="space-y-3">
        <p>編集できるのは下書きのデータセットだけです。</p>
        <Link href={`/datasets/${id}`} className="text-sky-700 hover:underline">
          詳細へ戻る
        </Link>
      </div>
    );
  }

  const [columns, tags, profiles] = await Promise.all([getColumns(id), getTagsByDataset([id]), getProfiles()]);
  const stewards = [...profiles.values()].filter((p) => p.role === 'steward');

  return (
    <div className="space-y-4">
      <Link href={`/datasets/${id}`} className="text-sm text-sky-700 hover:underline">
        ← 詳細へ
      </Link>
      <h1 className="text-xl font-bold">{dataset.name} を編集</h1>
      <EditForm dataset={dataset} columns={columns} tags={tags.get(id) ?? []} stewards={stewards} />
    </div>
  );
}
