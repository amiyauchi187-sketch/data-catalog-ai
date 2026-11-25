// 質問への回答（5.7）で使うモデルの一覧と、モデルごとに送れるパラメータ。
// モデルによって effort やサーバー側のフォールバックを受け付けないため、表で持って送り分ける。

export type QaModelSpec = {
  /** output_config.effort を送れるか（Haiku 4.5 は送ると400になる） */
  effort: boolean;
  /** サーバー側のフォールバック（fallbacks: "default"）を使えるか */
  fallbacks: boolean;
};

export const QA_MODELS = {
  'claude-haiku-4-5': { effort: false, fallbacks: false },
  'claude-haiku-5-5': { effort: true, fallbacks: false },
  'claude-sonnet-5-5': { effort: true, fallbacks: true },
  'claude-opus-5-5': { effort: true, fallbacks: true },
} as const satisfies Record<string, QaModelSpec>;

export type QaModel = keyof typeof QA_MODELS;

export const DEFAULT_PLANNER_MODEL: QaModel = 'claude-haiku-4-5';
export const DEFAULT_ANSWERER_MODEL: QaModel = 'claude-sonnet-5-5';

export function isQaModel(value: string): value is QaModel {
  return Object.prototype.hasOwnProperty.call(QA_MODELS, value);
}

/** 設定値をモデル名にする。空なら初期値、一覧にない名前なら日本語のエラー */
export function resolveModel(value: string | undefined, fallback: QaModel, label: string): QaModel {
  const name = value?.trim();
  if (!name) return fallback;
  if (!isQaModel(name)) {
    throw new Error(`${label}のモデル名「${name}」は使えません（使えるもの：${Object.keys(QA_MODELS).join('、')}）`);
  }
  return name;
}
