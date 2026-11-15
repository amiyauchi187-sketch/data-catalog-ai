'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { ActionState } from '@/components/form-parts';

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { errors: ['メールアドレスとパスワードを入力してください'] };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error?.name === 'AuthRetryableFetchError') {
    return { errors: ['認証サーバーに接続できませんでした。時間をおいてもう一度試してください'] };
  }
  // どちらが違うかは伝えない
  if (error) return { errors: ['メールアドレスかパスワードが正しくありません'] };

  redirect('/datasets');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
