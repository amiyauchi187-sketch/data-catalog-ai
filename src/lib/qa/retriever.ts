// 「探す」部分の型。キーワード検索とベクトル検索を差し替えられるよう、この形だけを外に見せる。

import type { DataType, Domain, Sensitivity } from '../../types/database.ts';
import type { ModelCall } from './claude-call.ts';

export type RetrievedColumn = {
  name: string;
  data_type: DataType;
  description: string | null;
  /** RLSで読めたサンプルだけ。読めない列は空 */
  samples: (string | null)[];
  is_pii: boolean;
};

export type RetrievedDataset = {
  id: string;
  name: string;
  description: string | null;
  domain: Domain | null;
  sensitivity: Sensitivity[];
  tags: string[];
  usage_notes: string | null;
  columns: RetrievedColumn[];
  /** 並べ替え用。キーワード検索では当たった数、ベクトル検索では類似度 */
  score: number;
};

export type RetrievalResult = {
  datasets: RetrievedDataset[];
  /** 探すためにAIを呼んだ記録（キーワードの取り出しなど） */
  calls: ModelCall[];
  /** 確認用。キーワード検索で使った言葉 */
  keywords: string[];
};

export interface DatasetRetriever {
  retrieve(question: string, opts: { limit: number }): Promise<RetrievalResult>;
}
