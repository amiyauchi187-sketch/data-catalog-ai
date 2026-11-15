import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-bold">AIデータカタログ</h1>
          <p className="mt-1 text-sm text-slate-500">サンプルリテール株式会社（架空）</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
