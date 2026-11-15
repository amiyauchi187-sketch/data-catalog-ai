// 個人情報の列のサンプルを伏せる。DB関数 mask_sample_values と同じ規則にする。

export const MASK = '***';

/** 空でない値をすべて *** にする。null と空文字はそのまま */
export function maskSamples(samples: (string | null)[]): (string | null)[] {
  return samples.map((v) => (v === null || v === '' ? v : MASK));
}

/** is_pii の列だけ伏せる */
export function maskIfPii(samples: (string | null)[], isPii: boolean): (string | null)[] {
  return isPii ? maskSamples(samples) : samples;
}
