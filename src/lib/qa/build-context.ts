// AIに渡す根拠データを組み立てる。送ってよい項目だけを一つずつ書き出す（許可リスト）。
// サンプルはRLSで読めた分だけが来ているが、送る直前にもう一度伏せる。

import { samplesForAi } from '../ai/build-input.ts';
import type { RetrievedDataset } from './retriever.ts';

export type ContextDataset = {
  id: string;
  name: string;
  description: string | null;
  domain: string | null;
  sensitivity: string[];
  tags: string[];
  usage_notes: string | null;
  columns: { name: string; data_type: string; description: string | null; samples: (string | null)[] }[];
};

export function toContextDataset(d: RetrievedDataset): ContextDataset {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    domain: d.domain,
    sensitivity: d.sensitivity,
    tags: d.tags,
    usage_notes: d.usage_notes,
    columns: d.columns.map((c) => ({
      name: c.name,
      data_type: c.data_type,
      description: c.description,
      samples: samplesForAi(c.samples, c.is_pii),
    })),
  };
}

export function buildContextJson(datasets: RetrievedDataset[]): string {
  return JSON.stringify(datasets.map(toContextDataset), null, 1);
}
