import { captureJobError } from "../job-error-tracker";

jest.mock("@sentry/node", () => ({
  captureException: jest.fn(),
}));

import * as Sentry from "@sentry/node";

describe("captureJobError", () => {
  const originalSentryDsn = process.env.SENTRY_DSN;

  afterEach(() => {
    jest.clearAllMocks();
    process.env.SENTRY_DSN = originalSentryDsn;
  });

  it("should do nothing when SENTRY_DSN is not set", () => {
    delete process.env.SENTRY_DSN;
    captureJobError("my-job", new Error("fail"));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("should capture Error instance directly", () => {
    process.env.SENTRY_DSN = "https://test@sentry.io/1";
    const err = new Error("something broke");
    captureJobError("my-job", err);
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { component: "job", job: "my-job" },
      extra: undefined,
    });
  });

  it("should wrap non-Error in new Error", () => {
    process.env.SENTRY_DSN = "https://test@sentry.io/1";
    captureJobError("my-job", "string error");
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { component: "job", job: "my-job" } })
    );
    const captured = (Sentry.captureException as jest.Mock).mock.calls[0][0] as Error;
    expect(captured.message).toContain("string error");
  });

  it("should wrap null/undefined in new Error", () => {
    process.env.SENTRY_DSN = "https://test@sentry.io/1";
    captureJobError("my-job", null);
    const captured = (Sentry.captureException as jest.Mock).mock.calls[0][0] as Error;
    expect(captured).toBeInstanceOf(Error);
  });

  it("should pass context as extra", () => {
    process.env.SENTRY_DSN = "https://test@sentry.io/1";
    const ctx = { userId: "u1", batchIndex: 3 };
    captureJobError("my-job", new Error("fail"), ctx);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      { tags: { component: "job", job: "my-job" }, extra: ctx }
    );
  });

  it("should pass job name in tags", () => {
    process.env.SENTRY_DSN = "https://test@sentry.io/1";
    captureJobError("watch-time-increment", new Error("fail"));
    const call = (Sentry.captureException as jest.Mock).mock.calls[0][1];
    expect(call.tags.job).toBe("watch-time-increment");
    expect(call.tags.component).toBe("job");
  });
});
