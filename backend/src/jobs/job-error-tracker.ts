import * as Sentry from "@sentry/node";

interface JobErrorContext {
  [key: string]: unknown;
}

export function captureJobError(
  jobName: string,
  error: unknown,
  context?: JobErrorContext
): void {
  if (!process.env.SENTRY_DSN) {
    return;
  }

  const normalizedError = error instanceof Error ? error : new Error(String(error));

  Sentry.captureException(normalizedError, {
    tags: {
      component: "job",
      job: jobName,
    },
    extra: context,
  });
}
