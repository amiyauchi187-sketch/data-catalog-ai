// Supabase（PostgREST）のエラーを、画面に出せる日本語のメッセージにする。
// DB関数の raise exception は日本語で書いてあるのでそのまま出す。それ以外は内部の情報を出さない。

type DbError = {
  code?: string;
  message: string;
};

const JAPANESE = /[぀-ヿ一-鿿]/;

export function toUserMessage(error: DbError): string {
  if (JAPANESE.test(error.message)) return error.message;
  switch (error.code) {
    case '42501':
      return 'この操作を行う権限がありません';
    case '23505':
      return '同じ内容がすでに登録されています';
    case '23514':
    case '23502':
      return '入力内容が保存の条件を満たしていません';
    case 'PGRST116':
      return 'データが見つかりません';
    default:
      return '処理に失敗しました。時間をおいてもう一度試してください';
  }
}
