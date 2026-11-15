"use client";

// 読み込みに失敗したときの表示。内部の情報は出さない
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">表示できませんでした</h1>
      <p className="text-sm text-slate-600">時間をおいてもう一度試してください。</p>
      <button type="button" onClick={reset} className="text-sky-700 hover:underline">
        再読み込み
      </button>
    </div>
  );
}
