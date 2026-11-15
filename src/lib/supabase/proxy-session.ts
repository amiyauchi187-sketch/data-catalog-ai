// proxy.ts から呼ぶ。セッションを更新し、ログインしていなければログイン画面へ移動する。

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseEnv } from './env';

const PUBLIC_PATHS = ['/login'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function redirectTo(request: NextRequest, pathname: string, source: NextResponse): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';
  const response = NextResponse.redirect(url);
  // 更新したセッションの Cookie と、キャッシュさせないヘッダーを引き継ぐ
  source.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  source.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'location') response.headers.set(key, value);
  });
  return response;
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { url, publishableKey } = getSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // getClaims は JWT の署名を確認する（getSession と違い、Cookie の中身をそのまま信じない）
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;

  if (!isLoggedIn && !isPublicPath(pathname)) return redirectTo(request, '/login', response);
  if (isLoggedIn && isPublicPath(pathname)) return redirectTo(request, '/datasets', response);
  return response;
}
