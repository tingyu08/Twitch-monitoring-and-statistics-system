interface JobErrorContext {
  [key: string]: unknown;
}

export function captureJobError(
  _jobName: string,
  _error: unknown,
  _context?: JobErrorContext
): void {
  // Error tracking integration removed. Keep this shim to avoid touching all callers.
}
