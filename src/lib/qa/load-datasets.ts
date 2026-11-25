// 質問への回答で使うカタログの読み取り。Supabase のクライアントを引数で受け取り、
// ログイン中の利用者のセッションで読むので、RLS で見えるものだけが返る。
// 画面（Cookieのセッション）からも、評価スクリプト（テスト利用者でログイン）からも使える。

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ColumnSample, Dataset, DatasetColumn, Domain } from '../../types/database.ts';

export type DatasetRow = Pick<
  Dataset,
  'id' | 'name' | 'description' | 'domain' | 'sensitivity' | 'usage_notes'
>;
export type ColumnRow = Pick<DatasetColumn, 'id' | 'dataset_id' | 'position' | 'name' | 'data_type' | 'description' | 'is_pii'>;

/** 探す処理が使う読み取り。テストでは偽物を渡す */
export interface CatalogReader {
  /** 公開中のデータセットをキーワードで探す */
  searchPublished(keyword: string): Promise<DatasetRow[]>;
  columns(datasetIds: string[]): Promise<ColumnRow[]>;
  samples(columnIds: string[]): Promise<ColumnSample[]>;
  tags(datasetIds: string[]): Promise<Map<string, string[]>>;
}

function failed(what: string): Error {
  return new Error(`${what}の読み込みに失敗しました`);
}

function toDatasetRow(d: Dataset): DatasetRow {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    domain: d.domain as Domain | null,
    sensitivity: d.sensitivity,
    usage_notes: d.usage_notes,
  };
}

async function searchPublished(supabase: SupabaseClient, keyword: string): Promise<DatasetRow[]> {
  // search_datasets は invoker なのでRLSが効く。スチュワードでも根拠は公開中だけにする
  const { data, error } = await supabase.rpc('search_datasets', {
    p_q: keyword,
    p_domains: null,
    p_sensitivities: null,
    p_statuses: ['published'],
  });
  if (error) throw failed('データセットの検索結果');
  return ((data ?? []) as Dataset[]).map(toDatasetRow);
}

async function readColumns(supabase: SupabaseClient, datasetIds: string[]): Promise<ColumnRow[]> {
  if (datasetIds.length === 0) return [];
  const { data, error } = await supabase
    .from('dataset_columns')
    .select('id, dataset_id, position, name, data_type, description, is_pii')
    .in('dataset_id', datasetIds)
    .order('position');
  if (error) throw failed('列の情報');
  return (data ?? []) as ColumnRow[];
}

async function readSamples(supabase: SupabaseClient, columnIds: string[]): Promise<ColumnSample[]> {
  if (columnIds.length === 0) return [];
  // RLS で隠れたサンプルは返らない
  const { data, error } = await supabase
    .from('dataset_column_samples')
    .select('column_id, sample_values')
    .in('column_id', columnIds);
  if (error) throw failed('サンプル');
  return (data ?? []) as ColumnSample[];
}

async function readTags(supabase: SupabaseClient, datasetIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (datasetIds.length === 0) return result;
  const { data, error } = await supabase.from('dataset_tags').select('dataset_id, tags(name)').in('dataset_id', datasetIds);
  if (error) throw failed('タグ');
  for (const row of (data ?? []) as unknown as { dataset_id: string; tags: { name: string } | null }[]) {
    if (row.tags) result.set(row.dataset_id, [...(result.get(row.dataset_id) ?? []), row.tags.name].sort());
  }
  return result;
}

export function createSupabaseCatalogReader(supabase: SupabaseClient): CatalogReader {
  return {
    searchPublished: (keyword) => searchPublished(supabase, keyword),
    columns: (ids) => readColumns(supabase, ids),
    samples: (ids) => readSamples(supabase, ids),
    tags: (ids) => readTags(supabase, ids),
  };
}
