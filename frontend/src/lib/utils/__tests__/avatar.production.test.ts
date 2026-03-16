describe("avatar utils in production", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it("uses a relative proxy URL in production when no API base is configured", () => {
    process.env = { ...originalEnv, NODE_ENV: "production" };
    delete process.env.NEXT_PUBLIC_API_URL;

    jest.isolateModules(() => {
      const { getProxiedAvatarUrl } = require("../avatar");
      const url = "https://static-cdn.jtvnw.net/jtv_user_pictures/demo-profile.png";

      expect(getProxiedAvatarUrl(url)).toBe(
        `/api/proxy/avatar?url=${encodeURIComponent(url)}`
      );
    });
  });
});
