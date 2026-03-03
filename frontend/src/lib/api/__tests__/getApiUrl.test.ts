/** @jest-environment node */

import { getApiUrl } from "../getApiUrl";

describe("getApiUrl", () => {
  const originalEnv = process.env;
  const originalWindow = globalThis.window;

  const setBrowserRuntime = (isBrowser: boolean) => {
    if (isBrowser) {
      (globalThis as { window?: Window }).window = originalWindow ?? ({} as Window);
      return;
    }

    (globalThis as { window?: Window }).window = undefined;
  };

  const setNodeEnv = (value: "development" | "production" | "test") => {
    process.env = {
      ...process.env,
      NODE_ENV: value,
    };
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_BACKEND_URL;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    setNodeEnv("test");
    setBrowserRuntime(true);
  });

  afterAll(() => {
    process.env = originalEnv;
    (globalThis as { window?: Window }).window = originalWindow;
  });

  it("adds a leading slash when endpoint has none", () => {
    expect(getApiUrl("api/viewer")).toBe("http://127.0.0.1:4000/api/viewer");
  });

  it("keeps endpoint slash when already present", () => {
    expect(getApiUrl("/api/viewer")).toBe("http://127.0.0.1:4000/api/viewer");
  });

  it("prefers NEXT_PUBLIC_BACKEND_URL over NEXT_PUBLIC_API_BASE_URL", () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = "http://backend.local:5000";
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://api-base.local:4000";

    expect(getApiUrl("/api/test")).toBe("http://backend.local:5000/api/test");
  });

  it("falls back to NEXT_PUBLIC_API_BASE_URL when backend URL is missing", () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://api-base.local:4000";

    expect(getApiUrl("/api/test")).toBe("http://api-base.local:4000/api/test");
  });

  it("uses NEXT_PUBLIC_API_BASE_URL when backend URL is empty string", () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = "";
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://api-base.local:4000";

    expect(getApiUrl("/api/test")).toBe("http://api-base.local:4000/api/test");
  });

  it("returns relative path in browser production even when backend URL exists", () => {
    setNodeEnv("production");
    process.env.NEXT_PUBLIC_BACKEND_URL = "https://backend.example.com";
    setBrowserRuntime(true);

    expect(getApiUrl("/api/prod")).toBe("/api/prod");
  });

  it("returns relative path in browser production when env URLs are empty", () => {
    setNodeEnv("production");
    process.env.NEXT_PUBLIC_BACKEND_URL = "";
    process.env.NEXT_PUBLIC_API_BASE_URL = "";
    setBrowserRuntime(true);

    expect(getApiUrl("api/prod")).toBe("/api/prod");
  });

  it("returns relative path when backendUrl resolves empty in browser runtime", () => {
    const dynamicEnv: Record<string, string | undefined> = {
      NEXT_PUBLIC_BACKEND_URL: "",
      NEXT_PUBLIC_API_BASE_URL: "",
      NODE_ENV: "production",
    };
    let reads = 0;

    Object.defineProperty(dynamicEnv, "NODE_ENV", {
      configurable: true,
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? "production" : "development";
      },
    });

    process.env = dynamicEnv as NodeJS.ProcessEnv;
    setBrowserRuntime(true);

    expect(getApiUrl("/api/dynamic")).toBe("/api/dynamic");
  });

  it("uses localhost default in non-production server runtime", () => {
    setBrowserRuntime(false);
    setNodeEnv("development");

    expect(getApiUrl("api/server")).toBe("http://127.0.0.1:4000/api/server");
  });

  it("uses API base URL in server runtime when backend URL is empty", () => {
    setBrowserRuntime(false);
    setNodeEnv("development");
    process.env.NEXT_PUBLIC_BACKEND_URL = "";
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api-base.example.com";

    expect(getApiUrl("/api/server")).toBe("https://api-base.example.com/api/server");
  });

  it("uses backend URL in server runtime when configured", () => {
    setBrowserRuntime(false);
    setNodeEnv("production");
    process.env.NEXT_PUBLIC_BACKEND_URL = "https://backend.example.com";

    expect(getApiUrl("/api/server")).toBe("https://backend.example.com/api/server");
  });

  it("returns relative path in server production when no env URL is set", () => {
    setBrowserRuntime(false);
    setNodeEnv("production");
    delete process.env.NEXT_PUBLIC_BACKEND_URL;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;

    expect(getApiUrl("/api/server")).toBe("/api/server");
  });

  it("handles empty endpoint as root path", () => {
    expect(getApiUrl("")).toBe("http://127.0.0.1:4000/");
  });

  it("treats missing NODE_ENV as non-production", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = undefined;

    expect(getApiUrl("api/viewer")).toBe("http://127.0.0.1:4000/api/viewer");
  });
});
