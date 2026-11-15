'use client';

// 状態を変える操作。押せない操作のボタンは出さない（最終判定はDB関数）

import Link from 'next/link';
import { useActionState } from 'react';
import type { DatasetStatus } from '@/types/database';
import type { DatasetAction } from '@/lib/datasets/status';
import {
  approveDataset,
  deleteDataset,
  retireDataset,
  returnToDraft,
  submitForReview,
} from '../actions';
import {
  ErrorList,
  buttonClass,
  dangerButtonClass,
  inputClass,
  subButtonClass,
  type ActionState,
} from '@/components/form-parts';

type Props = {
  datasetId: string;
  status: DatasetStatus;
  actions: DatasetAction[];
  isSelfApprovalBlocked: boolean;
};

function SimpleAction(props: {
  action: (prev: ActionState) => Promise<ActionState>;
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
      className="space-y-2"
    >
      <button type="submit" disabled={pending} className={props.className}>
        {pending ? '処理中…' : props.label}
      </button>
      <ErrorList state={state} />
    </form>
  );
}

function ReasonAction(props: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  label: string;
  placeholder: string;
  className: string;
}) {
  const [state, formAction, pending] = useActionState(props.action, null);
  return (
    <form action={formAction} className="space-y-2">
      <div className="flex gap-2">
        <input name="reason" required placeholder={props.placeholder} className={inputClass} />
        <button type="submit" disabled={pending} className={`${props.className} shrink-0`}>
          {pending ? '処理中…' : props.label}
        </button>
      </div>
      <ErrorList state={state} />
    </form>
  );
}

const RETURN_LABELS: Partial<Record<DatasetStatus, string>> = {
  pending_review: '差し戻す',
  published: '修正のため下書きに戻す',
};

export function StatusActions({ datasetId, status, actions, isSelfApprovalBlocked }: Props) {
  const has = (a: DatasetAction) => actions.includes(a);
  if (actions.length === 0 && !isSelfApprovalBlocked) return null;

  return (
    <div className="space-y-3 rounded-lg border border-sky-200 bg-sky-50/50 p-4">
      <h2 className="text-sm font-semibold text-slate-700">スチュワードの操作</h2>
      <div className="flex flex-wrap items-start gap-3">
        {has('edit') && (
          <Link href={`/datasets/${datasetId}/edit`} className={subButtonClass}>
            編集
          </Link>
        )}
        {has('submit') && (
          <SimpleAction action={submitForReview.bind(null, datasetId)} label="承認を依頼する" className={buttonClass} />
        )}
        {has('approve') && (
          <SimpleAction
            action={approveDataset.bind(null, datasetId)}
            label="承認して公開する"
            className={buttonClass}
            confirmMessage="承認すると、閲覧者に公開されます。よろしいですか？"
          />
        )}
        {has('delete') && (
          <SimpleAction
            action={deleteDataset.bind(null, datasetId)}
            label="削除"
            className={dangerButtonClass}
            confirmMessage="この下書きを削除します。元に戻せません。よろしいですか？"
          />
        )}
      </div>
      {isSelfApprovalBlocked && (
        <p className="text-sm text-amber-800">
          自分が登録または承認依頼したデータセットは承認できません。別のスチュワードに承認を依頼してください。
        </p>
      )}
      {has('return') && (
        <ReasonAction
          action={returnToDraft.bind(null, datasetId)}
          label={RETURN_LABELS[status] ?? '下書きに戻す'}
          placeholder="理由（必須）"
          className={subButtonClass}
        />
      )}
      {has('retire') && (
        <ReasonAction
          action={retireDataset.bind(null, datasetId)}
          label="廃止する"
          placeholder="廃止する理由（必須）"
          className={dangerButtonClass}
        />
      )}
    </div>
  );
}
