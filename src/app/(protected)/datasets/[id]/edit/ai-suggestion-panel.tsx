'use client';

// AI提案の表示と判断（採用・修正して採用・却下、まとめて採用・却下）。
// 提案は採用されるまでデータセットの項目に入らない。判断の記録と反映はDB関数が行う。

import { useActionState, useState } from 'react';
import type { AiField, AiSuggestion } from '@/types/database';
import {
  COLUMN_SENSITIVITY_LABELS,
  DOMAIN_LABELS,
  FIELD_LABELS,
  SENSITIVITY_LABELS,
  keysOf,
} from '@/lib/datasets/labels';
import { describeLogValue } from '@/lib/datasets/change-log-format';
import {
  ErrorList,
  buttonClass,
  dangerButtonClass,
  inputClass,
  subButtonClass,
  type ActionState,
} from '@/components/form-parts';
import { decideAllSuggestions, decideSuggestion, modifySuggestion, requestAiSuggestions } from '../../ai-actions';

type Props = {
  datasetId: string;
  suggestions: AiSuggestion[];
  /** 列の並び順（列名） */
  columnOrder: string[];
};

const NO_PROFILES = new Map();

function showValue(field: AiField, value: unknown): string {
  return describeLogValue(field, value, NO_PROFILES);
}

/** ボタン1つのフォーム。押すと action を呼び、エラーがあれば下に出す */
function ActionButton(props: {
  action: () => Promise<ActionState>;
  label: string;
  className: string;
  confirmMessage?: string;
}) {
  const [state, formAction, pending] = useActionState(props.action, null);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (props.confirmMessage && !window.confirm(props.confirmMessage)) e.preventDefault();
      }}
      className="inline-block space-y-1"
    >
      <button type="submit" disabled={pending} className={props.className}>
        {pending ? '処理中…' : props.label}
      </button>
      <ErrorList state={state} />
    </form>
  );
}

/** 「修正して採用」の入力欄。項目ごとに形が違う */
function FinalValueInput({ suggestion }: { suggestion: AiSuggestion }) {
  const value = suggestion.suggested_value;
  switch (suggestion.field) {
    case 'description':
    case 'column.description':
      return <textarea name="value" defaultValue={String(value ?? '')} rows={2} className={inputClass} />;
    case 'domain':
      return (
        <select name="value" defaultValue={String(value)} className={inputClass}>
          {keysOf(DOMAIN_LABELS).map((k) => (
            <option key={k} value={k}>
              {DOMAIN_LABELS[k]}
            </option>
          ))}
        </select>
      );
    case 'column.sensitivity':
      return (
        <select name="value" defaultValue={String(value)} className={inputClass}>
          {keysOf(COLUMN_SENSITIVITY_LABELS).map((k) => (
            <option key={k} value={k}>
              {COLUMN_SENSITIVITY_LABELS[k]}
            </option>
          ))}
        </select>
      );
    case 'sensitivity': {
      const selected = new Set(Array.isArray(value) ? value.map(String) : []);
      return (
        <div className="flex flex-wrap gap-3 text-sm">
          {keysOf(SENSITIVITY_LABELS).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input type="checkbox" name="value" value={k} defaultChecked={selected.has(k)} />
              {SENSITIVITY_LABELS[k]}
            </label>
          ))}
        </div>
      );
    }
    case 'tags':
      return (
        <input
          name="value"
          defaultValue={Array.isArray(value) ? value.join('、') : ''}
          placeholder="読点またはカンマで区切る"
          className={inputClass}
        />
      );
    case 'column.is_pii':
      return (
        <select name="value" defaultValue={String(value)} className={inputClass}>
          <option value="true">個人情報</option>
          <option value="false">個人情報ではない</option>
        </select>
      );
  }
}

function ModifyForm({ datasetId, suggestion, onCancel }: { datasetId: string; suggestion: AiSuggestion; onCancel: () => void }) {
  const action = modifySuggestion.bind(null, datasetId, suggestion.id, suggestion.field);
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="mt-2 space-y-2">
      <FinalValueInput suggestion={suggestion} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? '処理中…' : 'この値で採用'}
        </button>
        <button type="button" onClick={onCancel} className={subButtonClass}>
          やめる
        </button>
      </div>
      <ErrorList state={state} />
    </form>
  );
}

function SuggestionRow({ datasetId, suggestion }: { datasetId: string; suggestion: AiSuggestion }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-500">{FIELD_LABELS[suggestion.field] ?? suggestion.field}</div>
          <div className="text-sm">{showValue(suggestion.field, suggestion.suggested_value)}</div>
        </div>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            <ActionButton
              action={decideSuggestion.bind(null, datasetId, suggestion.id, 'accepted')}
              label="採用"
              className={buttonClass}
            />
            <button type="button" onClick={() => setEditing(true)} className={subButtonClass}>
              修正して採用
            </button>
            <ActionButton
              action={decideSuggestion.bind(null, datasetId, suggestion.id, 'rejected')}
              label="却下"
              className={subButtonClass}
            />
          </div>
        )}
      </div>
      {editing && <ModifyForm datasetId={datasetId} suggestion={suggestion} onCancel={() => setEditing(false)} />}
    </li>
  );
}

/** データセットの提案と、列ごとの提案に分ける */
function groupSuggestions(suggestions: AiSuggestion[], columnOrder: string[]) {
  const datasetLevel = suggestions.filter((s) => s.column_id === null);
  const byColumn = new Map<string, AiSuggestion[]>();
  for (const s of suggestions) {
    if (s.column_name === null) continue;
    byColumn.set(s.column_name, [...(byColumn.get(s.column_name) ?? []), s]);
  }
  const columns = columnOrder.filter((name) => byColumn.has(name)).map((name) => ({ name, items: byColumn.get(name)! }));
  return { datasetLevel, columns };
}

function SuggestionGroup(props: { title: string; reason: string | null; datasetId: string; items: AiSuggestion[] }) {
  return (
    <div className="rounded border border-violet-100 bg-white px-3 py-2">
      <div className="text-sm font-medium">{props.title}</div>
      {props.reason && <div className="text-xs text-slate-500">根拠：{props.reason}</div>}
      <ul className="divide-y divide-slate-100">
        {props.items.map((s) => (
          <SuggestionRow key={s.id} datasetId={props.datasetId} suggestion={s} />
        ))}
      </ul>
    </div>
  );
}

export function AiSuggestionPanel({ datasetId, suggestions, columnOrder }: Props) {
  const { datasetLevel, columns } = groupSuggestions(suggestions, columnOrder);
  const hasPending = suggestions.length > 0;

  return (
    <section className="space-y-3 rounded-lg border border-violet-200 bg-violet-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">
          <span className="mr-2 rounded bg-violet-600 px-1.5 py-0.5 text-xs text-white">AI提案</span>
          メタデータの提案
        </h2>
        <ActionButton
          action={requestAiSuggestions.bind(null, datasetId)}
          label={hasPending ? 'AIに提案させ直す' : 'AIに提案させる'}
          className={subButtonClass}
          confirmMessage={hasPending ? '未判断の提案は置き換えられます（採用率の計算からも外れます）。よろしいですか？' : undefined}
        />
      </div>
      <p className="text-xs text-slate-600">
        AIに送るのは、データセット名・列名・型・統計値と、伏せたサンプル値だけです。提案は採用するまでデータセットに入りません。
        判断すると画面が更新され、下の編集フォームで保存していない入力は消えます。
      </p>

      {hasPending ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">未判断の提案：{suggestions.length}件</span>
            <ActionButton
              action={decideAllSuggestions.bind(null, datasetId, 'accepted')}
              label="まとめて採用"
              className={buttonClass}
              confirmMessage={`未判断の提案${suggestions.length}件をすべて採用します。よろしいですか？`}
            />
            <ActionButton
              action={decideAllSuggestions.bind(null, datasetId, 'rejected')}
              label="まとめて却下"
              className={dangerButtonClass}
              confirmMessage={`未判断の提案${suggestions.length}件をすべて却下します。よろしいですか？`}
            />
          </div>
          {datasetLevel.length > 0 && (
            <SuggestionGroup
              title="データセット"
              reason={datasetLevel[0].reason}
              datasetId={datasetId}
              items={datasetLevel}
            />
          )}
          {columns.map((c) => (
            <SuggestionGroup
              key={c.name}
              title={`列：${c.name}`}
              reason={c.items[0].reason}
              datasetId={datasetId}
              items={c.items}
            />
          ))}
        </>
      ) : (
        <p className="text-sm text-slate-600">未判断の提案はありません。</p>
      )}
    </section>
  );
}
