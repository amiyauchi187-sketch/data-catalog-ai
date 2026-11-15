import { requireSteward } from '@/lib/auth/require-steward';
import { UploadForm } from './upload-form';

export default async function NewDatasetPage() {
  await requireSteward();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">CSVを登録</h1>
      <p className="text-sm text-slate-600">
        CSVはこのブラウザの中で読み取ります。原本はサーバーへ送らず、保存もしません。保存するのは列の情報と、個人情報の列を伏せた先頭5行のサンプルだけです。
      </p>
      <UploadForm />
    </div>
  );
}
