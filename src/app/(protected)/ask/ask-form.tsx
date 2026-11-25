'use client';

// 質問の入力と、回答の表示（回答文、足りないデータ、根拠のデータセットへのリンク）。

import Link from 'next/link';
import { useActionState } from 'react';
import { COVERAGE_LABELS, type Coverage } from '@/lib/qa/answer-schema';
import { MAX_QUESTION_LENGTH } from '@/lib/qa/ask';
import type { AskState, AskView } from '@/lib/qa/ask-view';
import { ErrorList, buttonClass, inputClass } from '@/components/form-parts';
import { askAction } from './actions';

const COVERAGE_CLASSES: Record<Coverage, string> = {
  full: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  partial: 'bg-amber-50 text-amber-800 border-amber-300',
  none: 'bg-slate-50 text-slate-700 border-slate-300',
};

function lastQuestion(state: AskState): string {
  if (!state) return '';
  return 'result' in state ? state.result.question : (state.question ?? '');
}

function CoverageBadge({ coverage }: { coverage: Coverage }) {
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${COVERAGE_CLASSES[coverage]}`}>
      {COVERAGE_LABELS[coverage]}
    </span>
  );
}

function MissingData({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-bold text-slate-700">足りないデータ</h3>
      <ul className="list-disc pl-5 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Sources({ sources }: { sources: AskView['sources'] }) {
  if (sources.length === 0) return null;
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-bold text-slate-700">根拠のデータセット</h3>
      <ul className="list-disc pl-5 text-sm">
        {sources.map((s) => (
          <li key={s.id}>
            <Link href={s.href} className="text-sky-700 hover:underline">
              {s.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnswerCard({ view }: { view: AskView }) {
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="space-y-1">
        <p className="text-sm text-slate-500">質問：{view.question}</p>
        <CoverageBadge coverage={view.coverage} />
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{view.answer}</p>
      <MissingData items={view.missing_data} />
      <Sources sources={view.sources} />
      {view.keywords.length > 0 && (
        <p className="text-xs text-slate-400">検索に使った言葉：{view.keywords.join('、')}</p>
      )}
    </section>
  );
}

export function AskForm() {
  const [state, formAction, pending] = useActionState(askAction, null);
  const errors = state && 'errors' in state ? { errors: state.errors } : null;

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-3">
        <textarea
          name="question"
          required
          rows={3}
          maxLength={MAX_QUESTION_LENGTH}
          defaultValue={lastQuestion(state)}
          key={lastQuestion(state)}
          placeholder="例：会員ランク別の売上を分析したい"
          className={inputClass}
        />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className={buttonClass}>
            {pending ? '回答を作成中…' : '質問する'}
          </button>
          <span className="text-xs text-slate-500">{MAX_QUESTION_LENGTH}文字以内。質問と回答は保存されません</span>
        </div>
        <ErrorList state={errors} />
      </form>
      {state && 'result' in state && <AnswerCard view={state.result} />}
    </div>
  );
}
