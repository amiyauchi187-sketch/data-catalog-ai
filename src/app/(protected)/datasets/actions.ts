'use server';

// データセットの作成・編集・状態の変更・削除。
// 権限はここでも確かめるが、最終的な判定はDB（RLS、列の権限、DB関数、CHECK制約）が行う。

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { toUserMessage } from '@/lib/supabase/errors';
import { checkSteward } from '@/lib/auth/require-steward';
import { parseColumnForm, parseDatasetForm, parseTags, type ColumnInput } from '@/lib/datasets/validation';
import type { CreateDatasetPayload } from '@/lib/datasets/payload';
import type { ActionState } from '@/components/form-parts';

type Supabase = Awaited<ReturnType<typeof createClient>>;

function fail(message: string): ActionState {
  return { errors: [message] };
}

function refresh(datasetId: string): void {
  revalidatePath('/datasets');
  revalidatePath(`/datasets/${datasetId}`);
}

/** DB関数を呼び、エラーなら日本語メッセージを返す */
async function callRpc(fn: string, args: Record<string, unknown>): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  return error ? toUserMessage(error) : null;
}

// ---- 作成 ----

export async function createDataset(payload: CreateDatasetPayload): Promise<ActionState> {
  const auth = await checkSteward();
  if ('error' in auth) return fail(auth.error);
  if (!payload.name) return fail('データセットの名称を入力してください');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_dataset', { payload });
  if (error) return fail(toUserMessage(error));

  revalidatePath('/datasets');
  redirect(`/datasets/${data as string}/edit`);
}

// ---- 編集 ----

async function updateDatasetRow(supabase: Supabase, id: string, form: FormData): Promise<string | null> {
  const parsed = parseDatasetForm(form);
  if (!parsed.ok) return parsed.errors.join('\n');

  const { data, error } = await supabase.from('datasets').update(parsed.value).eq('id', id).select('id');
  if (error) return toUserMessage(error);
  // RLS で更新できなかったときは0件になる
  if (!data || data.length === 0) return '編集できるのは下書きのデータセットだけです';
  return null;
}

async function updateColumnRow(supabase: Supabase, column: ColumnInput): Promise<string | null> {
  const { error } = await supabase
    .from('dataset_columns')
    .update({ description: column.description, sensitivity: column.sensitivity })
    .eq('id', column.id);
  return error ? toUserMessage(error) : null;
}

/** 個人情報の指定が変わった列だけ、DB関数で変える（サンプルを伏せる処理を伴うため） */
async function updateColumnPii(
  supabase: Supabase,
  columns: ColumnInput[],
  currentPii: Map<string, boolean>,
): Promise<string | null> {
  for (const column of columns) {
    if (currentPii.get(column.id) === column.is_pii) continue;
    const { error } = await supabase.rpc('set_column_pii', { p_column_id: column.id, p_is_pii: column.is_pii });
    if (error) return toUserMessage(error);
  }
  return null;
}

async function loadCurrentPii(supabase: Supabase, datasetId: string): Promise<Map<string, boolean>> {
  const { data } = await supabase.from('dataset_columns').select('id, is_pii').eq('dataset_id', datasetId);
  return new Map((data ?? []).map((c: { id: string; is_pii: boolean }) => [c.id, c.is_pii]));
}

export async function updateDataset(datasetId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const auth = await checkSteward();
  if ('error' in auth) return fail(auth.error);

  const supabase = await createClient();
  const currentPii = await loadCurrentPii(supabase, datasetId);
  const columns = parseColumnForm(form, [...currentPii.keys()]);
  const tags = parseTags(form.get('tags'));
  const inputErrors = [...(columns.ok ? [] : columns.errors), ...(tags.ok ? [] : tags.errors)];
  if (inputErrors.length > 0) return { errors: inputErrors };
  if (!columns.ok || !tags.ok) return null;

  const datasetError = await updateDatasetRow(supabase, datasetId, form);
  if (datasetError) return { errors: datasetError.split('\n') };

  for (const column of columns.value) {
    const columnError = await updateColumnRow(supabase, column);
    if (columnError) return fail(columnError);
  }

  const piiError = await updateColumnPii(supabase, columns.value, currentPii);
  if (piiError) return fail(piiError);

  const tagError = await callRpc('set_dataset_tags', { p_dataset_id: datasetId, p_names: tags.value });
  if (tagError) return fail(tagError);

  refresh(datasetId);
  redirect(`/datasets/${datasetId}`);
}

// ---- 状態の変更 ----

async function changeStatus(datasetId: string, fn: string, args: Record<string, unknown>): Promise<ActionState> {
  const auth = await checkSteward();
  if ('error' in auth) return fail(auth.error);

  const error = await callRpc(fn, { p_dataset_id: datasetId, ...args });
  if (error) return fail(error);

  refresh(datasetId);
  return null;
}

function reasonOf(form: FormData): string {
  return String(form.get('reason') ?? '').trim();
}

export async function submitForReview(datasetId: string): Promise<ActionState> {
  return changeStatus(datasetId, 'submit_for_review', {});
}

export async function approveDataset(datasetId: string): Promise<ActionState> {
  return changeStatus(datasetId, 'approve_dataset', {});
}

export async function returnToDraft(datasetId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return changeStatus(datasetId, 'return_to_draft', { p_reason: reasonOf(form) });
}

export async function retireDataset(datasetId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return changeStatus(datasetId, 'retire_dataset', { p_reason: reasonOf(form) });
}

export async function deleteDataset(datasetId: string): Promise<ActionState> {
  const auth = await checkSteward();
  if ('error' in auth) return fail(auth.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from('datasets').delete().eq('id', datasetId).select('id');
  if (error) return fail(toUserMessage(error));
  if (!data || data.length === 0) return fail('削除できるのは、一度も公開していない下書きだけです');

  revalidatePath('/datasets');
  redirect('/datasets');
}
