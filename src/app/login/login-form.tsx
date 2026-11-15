'use client';

import { useActionState } from 'react';
import { signIn } from './actions';
import { ErrorList, Field, buttonClass, inputClass } from '@/components/form-parts';

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, null);

  return (
    <form action={formAction} className="space-y-4">
      <ErrorList state={state} />
      <Field label="メールアドレス">
        <input name="email" type="email" autoComplete="email" required className={inputClass} />
      </Field>
      <Field label="パスワード">
        <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </Field>
      <button type="submit" disabled={pending} className={`${buttonClass} w-full justify-center`}>
        {pending ? 'ログイン中…' : 'ログイン'}
      </button>
    </form>
  );
}
