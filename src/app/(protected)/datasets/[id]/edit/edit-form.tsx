'use client';

// データセットと列のメタデータの編集

import { startTransition, useActionState, type FormEvent } from 'react';
import type { Dataset, DatasetColumn, Profile } from '@/types/database';
import {
  COLUMN_SENSITIVITY_LABELS,
  DATASET_NAME_NOTICE,
  DATA_TYPE_LABELS,
  DOMAIN_LABELS,
  SENSITIVITY_LABELS,
  UPDATE_FREQUENCY_LABELS,
  keysOf,
} from '@/lib/datasets/labels';
import { ErrorList, Field, buttonClass, inputClass } from '@/components/form-parts';
import { updateDataset } from '../../actions';

type Props = {
  dataset: Dataset;
  columns: DatasetColumn[];
  tags: string[];
  stewards: Profile[];
};

function Options({ labels }: { labels: Record<string, string> }) {
  return (
    <>
      <option value="">（未選択）</option>
      {Object.entries(labels).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function EditForm({ dataset, columns, tags, stewards }: Props) {
  const [state, formAction, pending] = useActionState(updateDataset.bind(null, dataset.id), null);

  // <form action> だと処理後に入力が初期値へ戻るため、エラー時に入力を残せるよう自分で送る
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <ErrorList state={state} />

      <Card title="業務メタデータ">
        <Field label="名称" hint={DATASET_NAME_NOTICE}>
          <input name="name" defaultValue={dataset.name} required maxLength={100} className={inputClass} />
        </Field>
        <Field label="説明" hint="承認依頼には必須です">
          <textarea name="description" defaultValue={dataset.description ?? ''} rows={3} className={inputClass} />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="データドメイン">
            <select name="domain" defaultValue={dataset.domain ?? ''} className={inputClass}>
              <Options labels={DOMAIN_LABELS} />
            </select>
          </Field>
          <Field label="業務用語タグ" hint="カンマか読点で区切る">
            <input name="tags" defaultValue={tags.join(', ')} className={inputClass} />
          </Field>
          <Field label="データオーナー" hint="部署名や役職名">
            <input name="owner_name" defaultValue={dataset.owner_name ?? ''} className={inputClass} />
          </Field>
          <Field label="担当スチュワード">
            <select name="steward_id" defaultValue={dataset.steward_id ?? ''} className={inputClass}>
              <option value="">（未選択）</option>
              {stewards.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-slate-700">機微度</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {keysOf(SENSITIVITY_LABELS).map((key) => (
              <label key={key} className="inline-flex items-center gap-1">
                <input type="checkbox" name="sensitivity" value={key} defaultChecked={dataset.sensitivity.includes(key)} />
                {SENSITIVITY_LABELS[key]}
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            「公開」は単独で選びます。「社内」と「機密」は一緒に選べません。個人情報の列があれば「個人情報を含む」が必要です。
          </p>
        </fieldset>
        <Field label="利用上の注意">
          <textarea name="usage_notes" defaultValue={dataset.usage_notes ?? ''} rows={2} className={inputClass} />
        </Field>
      </Card>

      <Card title="運用メタデータ">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="出所（元のシステム名）">
            <input name="source_system" defaultValue={dataset.source_system ?? ''} className={inputClass} />
          </Field>
          <Field label="更新頻度">
            <select name="update_frequency" defaultValue={dataset.update_frequency ?? ''} className={inputClass}>
              <Options labels={UPDATE_FREQUENCY_LABELS} />
            </select>
          </Field>
        </div>
      </Card>

      <Card title="列">
        <p className="text-xs text-slate-500">
          個人情報にチェックを入れると、保存時にサンプルを *** に伏せます。原本を保存していないため、チェックを外しても元の値には戻りません。
        </p>
        <ColumnFields columns={columns} />
      </Card>

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? '保存中…' : '保存'}
      </button>
    </form>
  );
}

function ColumnFields({ columns }: { columns: DatasetColumn[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="py-1 pr-3">列名</th>
            <th className="py-1 pr-3">型</th>
            <th className="py-1 pr-3">説明</th>
            <th className="py-1 pr-3">機微度</th>
            <th className="py-1">個人情報</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {columns.map((c) => (
            <tr key={c.id}>
              <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{c.name}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">{DATA_TYPE_LABELS[c.data_type]}</td>
              <td className="py-1.5 pr-3">
                <input
                  name={`col.${c.id}.description`}
                  defaultValue={c.description ?? ''}
                  className={inputClass}
                  aria-label={`${c.name}の説明`}
                />
              </td>
              <td className="py-1.5 pr-3">
                <select
                  name={`col.${c.id}.sensitivity`}
                  defaultValue={c.sensitivity ?? ''}
                  className={inputClass}
                  aria-label={`${c.name}の機微度`}
                >
                  <Options labels={COLUMN_SENSITIVITY_LABELS} />
                </select>
              </td>
              <td className="py-1.5 text-center">
                <input
                  type="checkbox"
                  name={`col.${c.id}.is_pii`}
                  defaultChecked={c.is_pii}
                  aria-label={`${c.name}は個人情報`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
