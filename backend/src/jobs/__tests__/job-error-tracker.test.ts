import { captureJobError } from "../job-error-tracker";

describe("captureJobError", () => {
  it("should be a no-op for Error", () => {
    captureJobError("my-job", new Error("fail"));
    expect(true).toBe(true);
  });

  it("should be a no-op for non-Error", () => {
    captureJobError("my-job", "string error");
    captureJobError("my-job", null);
    captureJobError("my-job", undefined);
    expect(true).toBe(true);
  });

  it("should accept optional context", () => {
    const ctx = { userId: "u1", batchIndex: 3 };
    captureJobError("my-job", new Error("fail"), ctx);
    expect(true).toBe(true);
  });
});
