jest.mock("../../utils/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { runWithWriteGuard } from "../job-write-guard";

describe("runWithWriteGuard", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // 設定 keyed mode 並且 gap = 0（測試環境）
    process.env.JOB_WRITE_GUARD_MODE = "keyed";
    process.env.JOB_WRITE_GAP_MS = "0";
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.JOB_WRITE_GUARD_MODE;
    delete process.env.JOB_WRITE_GAP_MS;
  });

  it("應執行 operation 並回傳結果", async () => {
    const operation = jest.fn().mockResolvedValue("result");
    const promise = runWithWriteGuard("unique-success:write", operation);
    jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe("result");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("operation 拋出錯誤時應傳遞錯誤", async () => {
    const operation = jest.fn().mockRejectedValue(new Error("DB error"));
    const promise = runWithWriteGuard("unique-error:write", operation);
    jest.runAllTimersAsync();
    await expect(promise).rejects.toThrow("DB error");
  });

  it("相同 key 的 job 應串行執行（不並發）", async () => {
    const order: number[] = [];
    const op1 = jest.fn(async () => {
      order.push(1);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      order.push(2);
    });
    const op2 = jest.fn(async () => {
      order.push(3);
    });

    const p1 = runWithWriteGuard("resource:op1", op1);
    const p2 = runWithWriteGuard("resource:op2", op2);

    jest.runAllTimersAsync();
    await Promise.all([p1, p2]);

    // op1 應在 op2 之前完成（1, 2 在 3 之前）
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(3));
  });

  it("不同 key 的 job 應可以並發執行", async () => {
    const started: string[] = [];
    const op1 = jest.fn(async () => {
      started.push("A");
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    });
    const op2 = jest.fn(async () => {
      started.push("B");
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    });

    const p1 = runWithWriteGuard("resource-a:op", op1);
    const p2 = runWithWriteGuard("resource-b:op", op2);

    jest.runAllTimersAsync();
    await Promise.all([p1, p2]);

    // 兩個 job 都應執行
    expect(started).toContain("A");
    expect(started).toContain("B");
  });

  it("global mode 下應使用全域鎖", async () => {
    process.env.JOB_WRITE_GUARD_MODE = "global";
    const operation = jest.fn().mockResolvedValue(42);
    const promise = runWithWriteGuard("any:job", operation);
    jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe(42);
  });

  it("job 沒有 : 分隔符時應以整個名稱作為 key", async () => {
    const operation = jest.fn().mockResolvedValue("ok");
    const promise = runWithWriteGuard("simplejob", operation);
    jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe("ok");
  });
});
