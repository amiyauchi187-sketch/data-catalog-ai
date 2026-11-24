'use server';

// AIによるメタデータ提案の作成と判断（採用・修正・却下、まとめて採用・却下）。
// 権限はここでも確かめるが、最終的な判定はDB関数（スチュワードか、下書きか、未判断か）が行う。

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { toUserMessage } from '@/lib/supabase/errors';
import { checkSteward } from '@/lib/auth/require-steward';
import { getColumnSamples, getColumns, getDataset } from '@/lib/datasets/queries';
import { buildSuggestionInput } from '@/lib/ai/build-input';
import { validateSuggestion } from '@/lib/ai/validate-output';
import { toSuggestionItems } from '@/lib/ai/to-rows';
import { getSuggester, type RawSuggestion } from '@/lib/ai/suggester';
import { PROMPT_VERSION } from '@/lib/ai/prompt';
import { parseFinalValue } from '@/lib/ai/parse-final';
import type { SuggestionInput } from '@/lib/ai/suggestion-schema';
import type { AiField } from '@/types/database';
import type { ActionState } from '@/components/form-parts';

function fail(message: string): ActionState {
  return { errors: [message] };
}

function refresh(datasetId: string): void {
  revalidatePath(`/datasets/${datasetId}`);
  revalidatePath(`/datasets/${datasetId}/edit`);
  revalidatePath('/ai-stats');
}

async function callRpc(fn: string, args: Record<string, unknown>): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  return error ? toUserMessage(error) : null;
}

/** AIに送るデータを、DBに保存してある列情報と伏せたサンプルから作る */
async function loadInput(datasetId: string): Promise<SuggestionInput | string> {
  const dataset = await getDataset(datasetId);
  if (!dataset) return 'データセットが見つかりません';
  if (dataset.status !== 'draft') return 'AI提案を作れるのは下書きのデータセットだけです';
  const columns = await getColumns(datasetId);
  const samples = await getColumnSamples(columns.map((c) => c.id));
  return buildSuggestionInput(dataset, columns, samples);
}

async function callAi(input: SuggestionInput): Promise<RawSuggestion | string> {
  try {
    return await getSuggester().suggest(input);
  } catch (error) {
    // 日本語のメッセージだけを出す（APIキーや送った内容は含めない）
    return error instanceof Error ? error.message : 'AIの呼び出しに失敗しました';
  }
}

export async function requestAiSuggestions(datasetId: string): Promise<ActionState> {
  const auth = await checkSteward();
  if ('error' in auth) return fail(auth.error);

  const input = await loadInput(datasetId);
  if (typeof input === 'string') return fail(input);

  const result = await callAi(input);
  if (typeof result === 'string') return fail(result);

  const checked = validateSuggestion(result.raw, input);
  if (!checked.ok) return { errors: ['AIの提案に問題があったため保存しませんでした', ...checked.errors] };

  const error = await callRpc('save_ai_suggestions', {
    p_dataset_id: datasetId,
    p_model: result.model,
    p_prompt_version: PROMPT_VERSION,
    p_usage: result.usage,
    p_items: toSuggestionItems(checked.value),
  });
  if (error) return fail(error);

  refresh(datasetId);
  return null;
}

/** 提案を1件、採用または却下する */
export async function decideSuggestion(
  datasetId: string,
  suggestionId: string,
  decision: 'accepted' | 'rejected',
): Promise<ActionState> {
  const auth = await checkSteward();
  if ('error' in auth) return fail(auth.error);

  const error = await callRpc('decide_ai_suggestion', { p_suggestion_id: suggestionId, p_decision: decision });
  if (error) return fail(error);

  refresh(datasetId);
  return null;
}

/** 提案を修正して採用する。値はフォームの value から読む */
export async function modifySuggestion(
  datasetId: string,
  suggestionId: string,
  field: AiField,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const auth = await checkSteward();
  if ('error' in auth) return fail(auth.error);

  const parsed = parseFinalValue(field, form);
  if (!parsed.ok) return { errors: parsed.errors };

  const error = await callRpc('decide_ai_suggestion', {
    p_suggestion_id: suggestionId,
    p_decision: 'modified',
    p_final: parsed.value,
  });
  if (error) return fail(error);

  refresh(datasetId);
  return null;
}

/** 未判断の提案をまとめて採用・却下する。履歴は提案ごとにDB関数が残す */
export async function decideAllSuggestions(datasetId: string, decision: 'accepted' | 'rejected'): Promise<ActionState> {
  const auth = await checkSteward();
  if ('error' in auth) return fail(auth.error);

  const error = await callRpc('decide_ai_suggestions_bulk', { p_dataset_id: datasetId, p_decision: decision });
  if (error) return fail(error);

  refresh(datasetId);
  return null;
}
