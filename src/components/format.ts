// 日時や割合の表示

const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function formatDateTime(value: string | null): string {
  return value ? dateTimeFormat.format(new Date(value)) : '—';
}

export function formatDate(value: string | null): string {
  return value ? dateFormat.format(new Date(value)) : '—';
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('ja-JP');
}
