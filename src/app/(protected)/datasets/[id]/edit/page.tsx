import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSteward } from '@/lib/auth/require-steward';
import { getColumns, getDataset, getPendingSuggestions, getProfiles, getTagsByDataset } from '@/lib/datasets/queries';
import { EditForm } from './edit-form';
import { AiSuggestionPanel } from './ai-suggestion-panel';

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

  const [columns, tags, profiles, suggestions] = await Promise.all([
    getColumns(id),
    getTagsByDataset([id]),
    getProfiles(),
    getPendingSuggestions(id),
  ]);
  const stewards = [...profiles.values()].filter((p) => p.role === 'steward');

  return (
    <div className="space-y-4">
      <Link href={`/datasets/${id}`} className="text-sm text-sky-700 hover:underline">
        ← 詳細へ
      </Link>
      <h1 className="text-xl font-bold">{dataset.name} を編集</h1>
      <AiSuggestionPanel datasetId={id} suggestions={suggestions} columnOrder={columns.map((c) => c.name)} />
      {/* AI提案を採用すると値が変わるので、更新日を key にしてフォームを作り直す */}
      <EditForm
        key={dataset.updated_at}
        dataset={dataset}
        columns={columns}
        tags={tags.get(id) ?? []}
        stewards={stewards}
      />
    </div>
  );
}
