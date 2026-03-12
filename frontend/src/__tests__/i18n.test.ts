describe("i18n config", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("exports supported locales and resolves valid request locales", async () => {
    let configFactory: ((args: { requestLocale: Promise<string> }) => Promise<unknown>) | undefined;

    jest.doMock("next-intl/server", () => ({
      getRequestConfig: jest.fn((factory) => {
        configFactory = factory;
        return factory;
      }),
    }));

    const i18nModule = await import("../i18n");
    const result = await configFactory?.({ requestLocale: Promise.resolve("en") });

    expect(i18nModule.locales).toEqual(["zh-TW", "en"]);
    expect(i18nModule.defaultLocale).toBe("zh-TW");
    expect(result).toEqual(
      expect.objectContaining({
        locale: "en",
        messages: expect.any(Object),
      })
    );
  });

  it("falls back to the default locale for invalid or missing locales", async () => {
    let configFactory: ((args: { requestLocale: Promise<string | undefined> }) => Promise<unknown>) | undefined;

    jest.doMock("next-intl/server", () => ({
      getRequestConfig: jest.fn((factory) => {
        configFactory = factory;
        return factory;
      }),
    }));

    await import("../i18n");

    const invalidResult = await configFactory?.({ requestLocale: Promise.resolve("jp") });
    const missingResult = await configFactory?.({ requestLocale: Promise.resolve(undefined) });

    expect(invalidResult).toEqual(
      expect.objectContaining({
        locale: "zh-TW",
        messages: expect.any(Object),
      })
    );
    expect(missingResult).toEqual(
      expect.objectContaining({
        locale: "zh-TW",
        messages: expect.any(Object),
      })
    );
  });
});
