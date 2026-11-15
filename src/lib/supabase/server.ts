// サーバー（Server Component、Server Action）で使う Supabase クライアント。
// ログイン中の利用者のセッションで接続するので、RLS がそのまま効く。

import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseEnv } from './env';

export async function createClient() {
  // 先に cookies() を読み、リクエストごとに描画するページだと Next.js に伝える
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabaseEnv();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component からは Cookie を書けない。セッションの更新は proxy.ts が行うので無視してよい
        }
      },
    },
  });
}
