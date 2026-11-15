// スチュワードだけが使える処理の入口で使う。最終的な判定はDB（RLS、DB関数）でも行う。

import 'server-only';
import { notFound } from 'next/navigation';
import { requireUser, type CurrentUser } from './require-user';

/** 画面用：スチュワードでなければ 404 にする */
export async function requireSteward(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isSteward) notFound();
  return user;
}

/** Server Action 用：スチュワードでなければエラーメッセージを返す */
export async function checkSteward(): Promise<{ user: CurrentUser } | { error: string }> {
  const user = await requireUser();
  if (!user.isSteward) return { error: 'この操作はスチュワードだけが行えます' };
  return { user };
}
