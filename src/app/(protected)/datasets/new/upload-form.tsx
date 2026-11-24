'use client';

// CSVをブラウザ内で読み、読み取り結果と個人情報の列を確認してから下書きを作る

import { useState, useTransition } from 'react';
import { analyzeCsv, type AnalyzedCsv } from '@/lib/csv/analyze';
import { piiReasonLabel } from '@/lib/csv/detect-pii';
import { MASK } from '@/lib/csv/mask';
import { buildCreatePayload, defaultDatasetName } from '@/lib/datasets/payload';
import { DATASET_NAME_NOTICE, DATA_TYPE_LABELS, ENCODING_LABELS } from '@/lib/datasets/labels';
import { ErrorList, Field, buttonClass, inputClass, type ActionState } from '@/components/form-parts';
import { formatNumber, formatPercent } from '@/components/format';
import { createDataset } from '../actions';

// 原本はサーバーへ送らないが、ブラウザで扱える大きさにしておく
const MAX_FILE_BYTES = 20 * 1024 * 1024;

type Loaded = { fileName: string; analyzed: AnalyzedCsv };

async function readFile(file: File): Promise<Loaded> {
  if (file.size > MAX_FILE_BYTES) throw new Error('ファイルが大きすぎます（20MBまで）');
  const buf = new Uint8Array(await file.arrayBuffer());
  return { fileName: file.name, analyzed: analyzeCsv(buf) };
}

function initialPii(analyzed: AnalyzedCsv): Set<number> {
  return new Set(analyzed.columns.filter((c) => c.piiReasons.length > 0).map((c) => c.position));
}

export function UploadForm() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [name, setName] = useState('');
  const [pii, setPii] = useState<Set<number>>(new Set());
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  async function onFileChange(file: File | undefined) {
    setState(null);
    setLoaded(null);
    if (!file) return;
    try {
      const result = await readFile(file);
      setLoaded(result);
      setName(defaultDatasetName(file.name));
      setPii(initialPii(result.analyzed));
    } catch (e) {
      setState({ errors: [e instanceof Error ? e.message : 'CSVを読み取れませんでした'] });
    }
  }

  function togglePii(position: number) {
    setPii((prev) => {
      const next = new Set(prev);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  }

  function onSubmit() {
    if (!loaded) return;
    const payload = buildCreatePayload(loaded.analyzed, { name, fileName: loaded.fileName, piiPositions: pii });
    startTransition(async () => {
      const result = await createDataset(payload);
      if (result) setState(result);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <Field label="CSVファイル" hint="UTF-8 または Shift_JIS。1行目は列名にしてください">
          <input type="file" accept=".csv,text/csv" onChange={(e) => onFileChange(e.target.files?.[0])} className="text-sm" />
        </Field>
      </div>
      <ErrorList state={state} />
      {loaded && (
        <>
          <Summary loaded={loaded} />
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <Field label="データセットの名称" hint={DATASET_NAME_NOTICE}>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={inputClass} />
            </Field>
          </div>
          <ColumnReview analyzed={loaded.analyzed} pii={pii} onToggle={togglePii} />
          <div className="flex items-center gap-3">
            <button type="button" onClick={onSubmit} disabled={pending || name.trim() === ''} className={buttonClass}>
              {pending ? '作成中…' : '下書きを作成'}
            </button>
            <span className="text-xs text-slate-500">作成後に、説明や機微度などを編集画面で入力します</span>
          </div>
        </>
      )}
    </div>
  );
}

function Summary({ loaded }: { loaded: Loaded }) {
  const { analyzed } = loaded;
  return (
    <p className="text-sm text-slate-700">
      {loaded.fileName}：{ENCODING_LABELS[analyzed.encoding]}、{formatNumber(analyzed.rowCount)} 件、
      {analyzed.columns.length} 列
    </p>
  );
}

function ColumnReview(props: { analyzed: AnalyzedCsv; pii: Set<number>; onToggle: (position: number) => void }) {
  const sampleCount = props.analyzed.columns[0]?.samples.length ?? 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">列と個人情報の確認</h2>
      <p className="mt-1 text-sm text-slate-600">
        チェックした列は個人情報として扱い、サンプルを {MASK} に伏せて保存します。列名と値の形から候補を選んでいます。
        備考などの自由記述の列は、プレビューを見て判断してください。
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 pr-3">個人情報</th>
              <th className="py-1 pr-3">列名</th>
              <th className="py-1 pr-3">型</th>
              <th className="py-1 pr-3 text-right">欠損率</th>
              <th className="py-1 pr-3 text-right">ユニーク数</th>
              {Array.from({ length: sampleCount }, (_, i) => (
                <th key={i} className="py-1 pr-3">
                  {i + 1}行目
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {props.analyzed.columns.map((c) => {
              const checked = props.pii.has(c.position);
              return (
                <tr key={c.position} className={checked ? 'bg-fuchsia-50/60' : ''}>
                  <td className="py-1.5 pr-3">
                    <label className="inline-flex items-center gap-1">
                      <input type="checkbox" checked={checked} onChange={() => props.onToggle(c.position)} />
                      {c.piiReasons.length > 0 && (
                        <span className="text-xs text-fuchsia-700">
                          候補（{c.piiReasons.map(piiReasonLabel).join('・')}）
                        </span>
                      )}
                    </label>
                  </td>
                  <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{c.name}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{DATA_TYPE_LABELS[c.dataType]}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatPercent(c.nullRate)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(c.distinctCount)}</td>
                  {c.samples.map((v, i) => (
                    <td key={i} className="py-1.5 pr-3 whitespace-nowrap">
                      {checked && v ? <span className="text-slate-400">{MASK}</span> : (v ?? <span className="text-slate-300">(空)</span>)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
