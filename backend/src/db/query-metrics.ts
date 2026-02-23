const MAX_SAMPLES = 200;

const durationRing = new Array<number>(MAX_SAMPLES);
let writeIndex = 0;
let sampleCount = 0;

export function recordQueryDuration(durationMs: number): void {
  durationRing[writeIndex] = durationMs;
  writeIndex = (writeIndex + 1) % MAX_SAMPLES;
  if (sampleCount < MAX_SAMPLES) {
    sampleCount += 1;
  }
}

function getDurationSnapshot(): number[] {
  const snapshot = new Array<number>(sampleCount);
  const oldestIndex = (writeIndex - sampleCount + MAX_SAMPLES) % MAX_SAMPLES;

  for (let i = 0; i < sampleCount; i += 1) {
    snapshot[i] = durationRing[(oldestIndex + i) % MAX_SAMPLES];
  }

  return snapshot;
}

export function getQueryStats(): {
  count: number;
  averageMs: number;
  p95Ms: number;
  maxMs: number;
} | null {
  if (sampleCount === 0) return null;

  const sorted = getDurationSnapshot().sort((a, b) => a - b);
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
