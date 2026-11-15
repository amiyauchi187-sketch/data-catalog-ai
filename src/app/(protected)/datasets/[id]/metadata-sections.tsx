// データセット単位のメタデータ（業務・技術・運用）

import type { Dataset, Profile } from '@/types/database';
import {
  DOMAIN_LABELS,
  ENCODING_LABELS,
  STATUS_LABELS,
  UPDATE_FREQUENCY_LABELS,
  sensitivityText,
} from '@/lib/datasets/labels';
import { formatDateTime, formatNumber } from '@/components/format';
import { DefinitionList, Section } from './section';

function nameOf(profiles: Map<string, Profile>, id: string | null): string {
  if (!id) return '—';
  return profiles.get(id)?.display_name ?? '（不明な利用者）';
}

export function MetadataSections({ dataset, profiles }: { dataset: Dataset; profiles: Map<string, Profile> }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Section title="業務メタデータ">
        <DefinitionList
          items={[
            ['説明', dataset.description ?? '—'],
            ['データドメイン', dataset.domain ? DOMAIN_LABELS[dataset.domain] : '—'],
            ['機微度', sensitivityText(dataset.sensitivity)],
            ['データオーナー', dataset.owner_name ?? '—'],
            ['担当スチュワード', nameOf(profiles, dataset.steward_id)],
            ['利用上の注意', dataset.usage_notes ?? '—'],
          ]}
        />
      </Section>
      <Section title="技術メタデータ">
        <DefinitionList
          items={[
            ['件数', formatNumber(dataset.row_count)],
            ['列数', formatNumber(dataset.column_count)],
            ['ファイル形式', dataset.file_format.toUpperCase()],
            ['文字コード', ENCODING_LABELS[dataset.encoding]],
            ['元のファイル名', dataset.source_file_name ?? '—'],
          ]}
        />
      </Section>
      <Section title="運用メタデータ">
        <DefinitionList
          items={[
            ['出所', dataset.source_system ?? '—'],
            ['更新頻度', dataset.update_frequency ? UPDATE_FREQUENCY_LABELS[dataset.update_frequency] : '—'],
            ['状態', STATUS_LABELS[dataset.status]],
            ['登録者', nameOf(profiles, dataset.created_by)],
            ['登録日', formatDateTime(dataset.created_at)],
            ['更新日', formatDateTime(dataset.updated_at)],
            ['承認依頼者', nameOf(profiles, dataset.submitted_by)],
            ['承認者', nameOf(profiles, dataset.approved_by)],
            ['承認日', formatDateTime(dataset.approved_at)],
            ...(dataset.retired_at
              ? ([['廃止日', formatDateTime(dataset.retired_at)]] as [string, string][])
              : []),
          ]}
        />
      </Section>
    </div>
  );
}
