/**
 * esm-import.ts 單元測試
 *
 * 不真的 import() @twurple／p-limit：npm test 開了 --experimental-vm-modules，
 * 同一個 jest process 裡若有其他測試檔先載入過這些 ESM，resetModules 後再做原生
 * import() 會報「Provided module is not an instance of Module」——結果取決於測試
 * 執行順序（--runInBand 必現，CI 上時好時壞）。改由 setNativeImport 注入假的 import。
 */

// Set JEST env var so importPLimit uses the shim
process.env.JEST_WORKER_ID = "1";

jest.mock("../p-limit-shim", () => ({ default: jest.fn() }));

type EsmImportModule = typeof import("../esm-import");

async function loadWithFakeImport(): Promise<{
  mod: EsmImportModule;
  fakeImport: jest.Mock;
}> {
  jest.resetModules();
  const mod = await import("../esm-import");
  const fakeImport = jest.fn(async (modulePath: string) => ({ loadedFrom: modulePath }));
  mod.__esmImportTestables.setNativeImport(fakeImport);
  return { mod, fakeImport };
}

describe("esm-import helpers", () => {
  it.each([
    ["importTwurpleApi", "@twurple/api"],
    ["importTwurpleAuth", "@twurple/auth"],
    ["importTwurpleChat", "@twurple/chat"],
    ["importTwurpleEventSub", "@twurple/eventsub-http"],
  ] as const)("%s 以原生 import() 載入 %s", async (helper, modulePath) => {
    const { mod, fakeImport } = await loadWithFakeImport();

    const loaded = await mod[helper]();

    expect(fakeImport).toHaveBeenCalledWith(modulePath);
    expect(loaded).toEqual({ loadedFrom: modulePath });
  });

  it("importPLimit uses p-limit-shim in Jest environment", async () => {
    process.env.JEST_WORKER_ID = "1";
    const { mod, fakeImport } = await loadWithFakeImport();

    const loaded = await mod.importPLimit();

    expect(loaded).toBeDefined();
    expect(fakeImport).not.toHaveBeenCalled();
  });

  it("caches module on repeated calls", async () => {
    const { mod, fakeImport } = await loadWithFakeImport();

    const first = await mod.importTwurpleApi();
    const second = await mod.importTwurpleApi();

    expect(first).toBe(second);
    expect(fakeImport).toHaveBeenCalledTimes(1);
  });

  it("throws for disallowed module names", async () => {
    const { mod, fakeImport } = await loadWithFakeImport();

    await expect(mod.__esmImportTestables.importEsm("not-allowed")).rejects.toThrow(
      "[esm-import] Module not allowed: not-allowed"
    );
    expect(fakeImport).not.toHaveBeenCalled();
  });

  it("setNativeImport() 不帶參數時還原為原生 import，並清掉快取", async () => {
    const { mod, fakeImport } = await loadWithFakeImport();
    await mod.importTwurpleApi();

    const replacement = jest.fn(async () => ({ replaced: true }));
    mod.__esmImportTestables.setNativeImport(replacement);
    await expect(mod.importTwurpleApi()).resolves.toEqual({ replaced: true });

    expect(fakeImport).toHaveBeenCalledTimes(1);
    expect(replacement).toHaveBeenCalledTimes(1);
    mod.__esmImportTestables.setNativeImport();
  });
});

describe("importPLimit without JEST env", () => {
  afterEach(() => {
    process.env.JEST_WORKER_ID = "1";
  });

  it("uses shim when JEST_WORKER_ID is set", async () => {
    process.env.JEST_WORKER_ID = "2";
    const { mod, fakeImport } = await loadWithFakeImport();

    const result = await mod.importPLimit();

    expect(result).toBeDefined();
    expect(fakeImport).not.toHaveBeenCalled();
  });

  it("imports p-limit through the native import when JEST_WORKER_ID is absent", async () => {
    const { mod, fakeImport } = await loadWithFakeImport();
    delete process.env.JEST_WORKER_ID;

    const result = await mod.importPLimit();

    expect(fakeImport).toHaveBeenCalledWith("p-limit");
    expect(result).toEqual({ loadedFrom: "p-limit" });
  });
});
