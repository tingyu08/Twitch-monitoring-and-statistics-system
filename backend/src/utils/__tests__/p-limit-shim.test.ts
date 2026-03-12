import pLimit, { __pLimitTestables } from "../p-limit-shim";

describe("p-limit-shim", () => {
  it("runs immediately when active count is below concurrency", async () => {
    const limit = pLimit(2);
    await expect(limit(async () => "ok")).resolves.toBe("ok");
  });

  it("defaults concurrency to at least 1", async () => {
    const limit = pLimit(0);
    const order: string[] = [];

    const first = limit(async () => {
      order.push("first");
      return "first";
    });
    const second = limit(async () => {
      order.push("second");
      return "second";
    });

    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(order).toEqual(["first", "second"]);
  });

  it("queues tasks when concurrency is reached", async () => {
    const limit = pLimit(1);
    let release!: () => void;
    const first = limit(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve("first");
        })
    );

    const second = limit(async () => "second");

    release();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });

  it("createRunNext returns early when active count is already at concurrency", () => {
    const queued = jest.fn();
    const runNext = __pLimitTestables.createRunNext(() => 1, 1, [queued]);

    runNext();

    expect(queued).not.toHaveBeenCalled();
  });
});
