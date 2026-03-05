export function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const raw = String(value ?? '').trim();
  if (!raw) return new Date(0);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T00:00:00+09:00`);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return new Date(0);
  return parsed;
}

export function formatDate(value: string | Date): string {
  return toDate(value).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

export function todayKST(): string {
  const now = new Date();
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kst = new Date(now.getTime() + kstOffsetMs);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
