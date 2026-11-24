import Link from 'next/link';
import { requireUser } from '@/lib/auth/require-user';
import { signOut } from '../login/actions';

// ログイン必須の範囲。サーバー側でログインを確認する
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/datasets" className="font-bold">
            AIデータカタログ
          </Link>
          <div className="flex items-center gap-4 text-sm">
            {user.isSteward && (
              <Link href="/ai-stats" className="text-sky-700 hover:underline">
                AI提案の採用率
              </Link>
            )}
            <span>
              {user.display_name}
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                {user.isSteward ? 'データスチュワード' : '閲覧者'}
              </span>
            </span>
            <form action={signOut}>
              <button type="submit" className="text-slate-500 hover:text-slate-800">
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">{children}</main>
    </>
  );
}
