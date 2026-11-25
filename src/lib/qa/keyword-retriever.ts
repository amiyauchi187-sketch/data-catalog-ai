// キーワード検索で関係するデータセットを探す（DatasetRetriever の実装）。
// 質問からキーワードを取り出し、キーワードごとに search_datasets を呼んで結果を合わせ、当たった数で並べる。

import type { ColumnSample, Domain } from '../../types/database.ts';
import type { CatalogReader, ColumnRow, DatasetRow } from './load-datasets.ts';
import type { QueryPlanner } from './query-planner.ts';
import type { DatasetRetriever, RetrievedColumn, RetrievedDataset } from './retriever.ts';

/** ドメインが合ったときの加点。キーワード1つ分より小さくし、並べ替えの同点を崩すだけに使う */
const DOMAIN_BONUS = 0.5;

type Hit = { row: DatasetRow; score: number };

/** キーワードごとの検索結果を合わせ、当たったキーワードの数（＋ドメインの加点）で並べる */
export function mergeHits(resultsByKeyword: DatasetRow[][], domains: Domain[]): Hit[] {
  const hits = new Map<string, Hit>();
  for (const rows of resultsByKeyword) {
    for (const row of rows) {
      const hit = hits.get(row.id) ?? { row, score: 0 };
      hit.score += 1;
      hits.set(row.id, hit);
    }
  }
  for (const hit of hits.values()) {
    if (hit.row.domain && domains.includes(hit.row.domain)) hit.score += DOMAIN_BONUS;
  }
  return [...hits.values()].sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name, 'ja'));
}

/** 列とサンプルを、データセットごとの列の一覧にする。サンプルが返らなかった列（RLSで隠れた列）は空 */
export function groupColumns(columns: ColumnRow[], samples: ColumnSample[]): Map<string, RetrievedColumn[]> {
  const samplesByColumn = new Map(samples.map((s) => [s.column_id, s.sample_values]));
  const result = new Map<string, RetrievedColumn[]>();
  for (const c of [...columns].sort((a, b) => a.position - b.position)) {
    const column: RetrievedColumn = {
      name: c.name,
      data_type: c.data_type,
      description: c.description,
      samples: samplesByColumn.get(c.id) ?? [],
      is_pii: c.is_pii,
    };
    result.set(c.dataset_id, [...(result.get(c.dataset_id) ?? []), column]);
  }
  return result;
}

/** 見つかったデータセットに、列・サンプル・タグを付ける */
async function attachDetails(reader: CatalogReader, hits: Hit[]): Promise<RetrievedDataset[]> {
  const ids = hits.map((h) => h.row.id);
  const [columns, tags] = await Promise.all([reader.columns(ids), reader.tags(ids)]);
  const samples = await reader.samples(columns.map((c) => c.id));
  const columnsByDataset = groupColumns(columns, samples);
  return hits.map(({ row, score }) => ({
    ...row,
    tags: tags.get(row.id) ?? [],
    columns: columnsByDataset.get(row.id) ?? [],
    score,
  }));
}

export function createKeywordRetriever(reader: CatalogReader, planner: QueryPlanner): DatasetRetriever {
  return {
    async retrieve(question, { limit }) {
      const { plan, calls } = await planner.plan(question);
      const results = await Promise.all(plan.keywords.map((k) => reader.searchPublished(k)));
      const hits = mergeHits(results, plan.domains).slice(0, limit);
      const datasets = hits.length > 0 ? await attachDetails(reader, hits) : [];
      return { datasets, calls, keywords: plan.keywords };
    },
  };
}
