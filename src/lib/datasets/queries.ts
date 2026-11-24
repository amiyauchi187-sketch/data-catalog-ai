// データセットまわりの読み取り。ログイン中の利用者のセッションで読むので、RLS で見えるものだけが返る。

import 'server-only';
import { createClient } from '../supabase/server';
import type {
  AiSuggestion,
  AiSuggestionStat,
  ChangeLog,
  ColumnSample,
  Dataset,
  DatasetColumn,
  Profile,
} from '../../types/database';
import type { SearchFilters } from './search-params';

function nullIfEmpty<T>(values: T[]): T[] | null {
  return values.length > 0 ? values : null;
}

function failed(what: string): Error {
  return new Error(`${what}の読み込みに失敗しました`);
}

export async function searchDatasets(filters: SearchFilters): Promise<Dataset[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('search_datasets', {
    p_q: filters.q || null,
    p_domains: nullIfEmpty(filters.domains),
    p_sensitivities: nullIfEmpty(filters.sensitivities),
    p_statuses: nullIfEmpty(filters.statuses),
  });
  if (error) throw failed('データセットの一覧');
  return (data ?? []) as Dataset[];
}

/** 見えないデータセット（閲覧者にとっての下書きなど）は null */
export async function getDataset(id: string): Promise<Dataset | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('datasets').select('*').eq('id', id).maybeSingle<Dataset>();
  // id が uuid の形でないときもエラーになるので、見つからない扱いにする
  if (error) return null;
  return data;
}

export async function getColumns(datasetId: string): Promise<DatasetColumn[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('dataset_columns')
    .select('id, dataset_id, position, name, data_type, null_count, null_rate, distinct_count, description, sensitivity, is_pii')
    .eq('dataset_id', datasetId)
    .order('position');
  if (error) throw failed('列の情報');
  return (data ?? []).map((c) => ({ ...c, null_rate: Number(c.null_rate) })) as DatasetColumn[];
}

/** RLS で見えない列のサンプルは返らない */
export async function getColumnSamples(columnIds: string[]): Promise<ColumnSample[]> {
  if (columnIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('dataset_column_samples')
    .select('column_id, sample_values')
    .in('column_id', columnIds);
  if (error) throw failed('サンプル');
  return (data ?? []) as ColumnSample[];
}

/** データセットIDごとのタグ名 */
export async function getTagsByDataset(datasetIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (datasetIds.length === 0) return result;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('dataset_tags')
    .select('dataset_id, tags(name)')
    .in('dataset_id', datasetIds);
  if (error) throw failed('タグ');
  for (const row of (data ?? []) as unknown as { dataset_id: string; tags: { name: string } | null }[]) {
    if (!row.tags) continue;
    result.set(row.dataset_id, [...(result.get(row.dataset_id) ?? []), row.tags.name].sort());
  }
  return result;
}

export async function getProfiles(): Promise<Map<string, Profile>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('profiles').select('id, display_name, role');
  if (error) throw failed('利用者');
  return new Map(((data ?? []) as Profile[]).map((p) => [p.id, p]));
}

/** スチュワードにだけ返る（RLS） */
export async function getChangeLogs(datasetId: string): Promise<ChangeLog[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('change_logs')
    .select('*')
    .eq('dataset_id', datasetId)
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw failed('変更履歴');
  return (data ?? []) as ChangeLog[];
}

/** 未判断のAI提案（スチュワードにだけ返る） */
export async function getPendingSuggestions(datasetId: string): Promise<AiSuggestion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ai_suggestions')
    .select('*')
    .eq('dataset_id', datasetId)
    .eq('decision', 'pending')
    .order('created_at');
  if (error) throw failed('AI提案');
  return (data ?? []) as AiSuggestion[];
}

/** AI提案の採用率の集計（スチュワードにだけ返る） */
export async function getSuggestionStats(): Promise<AiSuggestionStat[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ai_suggestion_stats')
    .select('*')
    .order('prompt_version')
    .order('field');
  if (error) throw failed('AI提案の集計');
  return (data ?? []) as AiSuggestionStat[];
}
