'use server';

// 質問への回答（5.7）。ログイン中の利用者のセッションで探すので、RLSで見えるものだけが根拠になる。
// 質問と回答はDBに保存しない。

import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/require-user';
import { askQuestion, normalizeQuestion } from '@/lib/qa/ask';
import { createQa } from '@/lib/qa/create-qa';
import { toAskView, type AskState } from '@/lib/qa/ask-view';

function fail(message: string): AskState {
  return { errors: [message] };
}

/** 例外を、画面に出してよい日本語のメッセージにする（lib/qa のエラーはAPIキーや送った内容を含まない） */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : '回答の作成に失敗しました';
}

export async function askAction(_prev: AskState, form: FormData): Promise<AskState> {
  const user = await getCurrentUser();
  if (!user) return fail('ログインしてください');

  let question: string;
  try {
    question = normalizeQuestion(form.get('question'));
  } catch (error) {
    return { errors: [toMessage(error)], question: String(form.get('question') ?? '') };
  }

  try {
    const qa = createQa(await createClient(), process.env);
    const result = await askQuestion(question, qa);
    return { result: toAskView(question, result) };
  } catch (error) {
    return { errors: [toMessage(error)], question };
  }
}
