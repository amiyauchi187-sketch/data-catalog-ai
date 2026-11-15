import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl space-y-3 p-10">
      <h1 className="text-xl font-bold">ページが見つかりません</h1>
      <p className="text-sm text-slate-600">存在しないか、見る権限がありません。</p>
      <Link href="/datasets" className="text-sky-700 hover:underline">
        データセットの一覧へ
      </Link>
    </main>
  );
}
