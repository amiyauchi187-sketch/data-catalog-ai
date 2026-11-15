// 状態ごとに、誰がどの操作をできるかを決める。DB関数と同じ規則で、ボタンの出し分けに使う。
// 最終的な判定はDB関数・RLS・CHECK制約が行う。

import type { Dataset } from '../../types/database.ts';

export type DatasetAction = 'edit' | 'submit' | 'approve' | 'return' | 'retire' | 'delete';

type Actor = {
  userId: string;
  isSteward: boolean;
};

type DatasetState = Pick<Dataset, 'status' | 'created_by' | 'submitted_by' | 'first_published_at'>;

/** 登録者か承認依頼者なら、承認できない */
export function isSelfApproval(dataset: DatasetState, userId: string): boolean {
  return dataset.created_by === userId || dataset.submitted_by === userId;
}

function canDo(action: DatasetAction, dataset: DatasetState, actor: Actor): boolean {
  switch (action) {
    case 'edit':
    case 'submit':
      return dataset.status === 'draft';
    case 'approve':
      return dataset.status === 'pending_review' && !isSelfApproval(dataset, actor.userId);
    case 'return':
      return dataset.status === 'pending_review' || dataset.status === 'published';
    case 'retire':
      return dataset.status === 'published';
    case 'delete':
      return dataset.status === 'draft' && dataset.first_published_at === null;
  }
}

const ALL_ACTIONS: DatasetAction[] = ['edit', 'submit', 'approve', 'return', 'retire', 'delete'];

/** この利用者がこのデータセットに対してできる操作の一覧 */
export function availableActions(dataset: DatasetState, actor: Actor): DatasetAction[] {
  if (!actor.isSteward) return [];
  return ALL_ACTIONS.filter((action) => canDo(action, dataset, actor));
}
