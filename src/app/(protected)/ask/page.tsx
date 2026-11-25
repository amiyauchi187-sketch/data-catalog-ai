// 質問（5.7）。カタログについての質問に、根拠のデータセットへのリンク付きで答える。ログイン済みなら誰でも使える

import { requireUser } from '@/lib/auth/require-user';
import { AskForm } from './ask-form';

export default async function AskPage() {
  await requireUser();

  return (
    <div className="max-w-3xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-bold">カタログに質問する</h1>
        <p className="text-sm text-slate-600">
          分析したいことを書くと、公開中のデータセットから使えるものを探して答えます。AIの回答は誤ることがあるので、根拠のデータセットで列の内容を確かめてください。
        </p>
      </div>
      <AskForm />
    </div>
  );
}
