const MAX_SAMPLES = 200;

const durations: number[] = [];

export function recordQueryDuration(durationMs: number): void {
  durations.push(durationMs);
  if (durations.length > MAX_SAMPLES) {
    durations.shift();
  }
}

export function getQueryStats(): {
  count: number;
  averageMs: number;
  p95Ms: number;
  maxMs: number;
} | null {
  if (durations.length === 0) return null;

  const sorted = [...durations].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = Math.round((sum / count) * 100) / 100;
  const p95Index = Math.max(0, Math.ceil(count * 0.95) - 1);

  return {
    count,
    averageMs: avg,
    p95Ms: sorted[p95Index],
    maxMs: sorted[count - 1],
  };
}
