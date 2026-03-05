import { logger } from "./logger";

type JobCircuitState = {
  consecutiveFailures: number;
  pausedUntil: number | null;
};

export type JobCircuitSnapshot = {
  jobName: string;
  consecutiveFailures: number;
  pausedUntil: string | null;
  paused: boolean;
};

const states = new Map<string, JobCircuitState>();

const DEFAULT_FAILURE_THRESHOLD = Number.parseInt(
  process.env.JOB_CIRCUIT_BREAKER_FAILURE_THRESHOLD || "3",
  10
);
const DEFAULT_PAUSE_MS = Number.parseInt(process.env.JOB_CIRCUIT_BREAKER_PAUSE_MS || "300000", 10);

function getState(jobName: string): JobCircuitState {
  const state = states.get(jobName);
  if (state) {
    return state;
  }

  const initial: JobCircuitState = {
    consecutiveFailures: 0,
    pausedUntil: null,
  };
  states.set(jobName, initial);
  return initial;
}

export function isTransientDbConnectivityError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const msg = error.message.toLowerCase();
  return (
    msg.includes("eai_again") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("pipeline failed")
  );
}

export function shouldSkipForCircuitBreaker(jobName: string): boolean {
  const state = getState(jobName);
  if (!state.pausedUntil) {
    return false;
  }

  if (Date.now() >= state.pausedUntil) {
    state.pausedUntil = null;
    state.consecutiveFailures = 0;
    return false;
  }

  return true;
}

export function recordJobSuccess(jobName: string): void {
  const state = getState(jobName);
  state.consecutiveFailures = 0;
  state.pausedUntil = null;
}

export function recordJobFailure(jobName: string, error: unknown): void {
  if (!isTransientDbConnectivityError(error)) {
    return;
  }

  const state = getState(jobName);
  state.consecutiveFailures += 1;

  if (state.consecutiveFailures >= DEFAULT_FAILURE_THRESHOLD) {
    state.pausedUntil = Date.now() + DEFAULT_PAUSE_MS;
    logger.warn(
      "JobCircuitBreaker",
      `${jobName} paused for ${Math.round(DEFAULT_PAUSE_MS / 1000)}s after ${state.consecutiveFailures} transient DB failures`
    );
  }
}

export function getJobCircuitBreakerSnapshot(): JobCircuitSnapshot[] {
  const now = Date.now();
  return Array.from(states.entries())
    .map(([jobName, state]) => ({
      jobName,
      consecutiveFailures: state.consecutiveFailures,
      pausedUntil: state.pausedUntil ? new Date(state.pausedUntil).toISOString() : null,
      paused: typeof state.pausedUntil === "number" && state.pausedUntil > now,
    }))
    .sort((a, b) => a.jobName.localeCompare(b.jobName));
}
