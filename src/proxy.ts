// すべてのページで、セッションの更新と未ログインの移動を行う
import type { NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/proxy-session';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
