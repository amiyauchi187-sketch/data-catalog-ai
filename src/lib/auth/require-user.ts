// ログイン中の利用者を取得する。ログインしていなければログイン画面へ移動する。

import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '../supabase/server';
import type { Profile } from '../../types/database';

export type CurrentUser = Profile & { isSteward: boolean };

/** ログイン中なら利用者を返し、そうでなければ null。1回のリクエスト内では結果を使い回す */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, display_name, role')
    .eq('id', userId)
    .maybeSingle<Profile>();
  if (!profile) return null;

  return { ...profile, isSteward: profile.role === 'steward' };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}
