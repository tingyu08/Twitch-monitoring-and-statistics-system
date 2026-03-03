import { httpClient, resolveApiBaseUrl } from "../httpClient";

global.fetch = jest.fn();
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

const jsonResponse = <T>(
  data: T,
  status = 200,
  contentType = "application/json"
): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(contentType ? { "content-type": contentType } : undefined),
    json: async () => data,
    text: async () => JSON.stringify(data),
  }) as Response;

const textResponse = (text: string, status = 200, contentType = "text/plain"): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(contentType ? { "content-type": contentType } : undefined),
    json: async () => ({ message: text }),
    text: async () => text,
  }) as Response;

describe("httpClient", () => {
  const originalEnv = process.env;
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  let cookieStore = "";

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    process.env = { ...originalEnv, NODE_ENV: "test" };
    cookieStore = "session=test-cookie";

    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => cookieStore,
      set: (value: string) => {
        cookieStore = value;
      },
    });

    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    }
  });

  afterAll(() => {
    process.env = originalEnv;
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    }
  });

  it("makes a successful GET request with default JSON headers", async () => {
    const payload = { id: 1, name: "Test" };
    mockFetch.mockResolvedValueOnce(jsonResponse(payload));

    const result = await httpClient("/test");

    expect(result).toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith(
      "/test",
      expect.objectContaining({
        credentials: "include",
        signal: expect.any(AbortSignal),
      })
    );

    const requestConfig = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const headers = requestConfig.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("normalizes relative endpoints without leading slash", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

    await httpClient("test");

    expect(mockFetch).toHaveBeenCalledWith("/test", expect.any(Object));
  });

  it("keeps absolute URLs unchanged", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

    await httpClient("https://example.com/health");

    expect(mockFetch).toHaveBeenCalledWith("https://example.com/health", expect.any(Object));
  });

  it("merges custom headers and keeps caller content-type", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

    await httpClient("/test", {
      headers: {
        "Content-Type": "text/plain",
        "X-Custom-Header": "value",
      },
      credentials: "same-origin",
    });

    const requestConfig = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const headers = requestConfig.headers as Headers;
    expect(headers.get("Content-Type")).toBe("text/plain");
    expect(headers.get("X-Custom-Header")).toBe("value");
    expect(requestConfig.credentials).toBe("same-origin");
  });

  it("does not set content-type for FormData bodies", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
    const formData = new FormData();
    formData.set("name", "alice");

    await httpClient("/upload", { method: "POST", body: formData });

    const requestConfig = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const headers = requestConfig.headers as Headers;
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("reads non-JSON and missing content-type responses as text", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("Plain text response", 200, "text/plain"));
    mockFetch.mockResolvedValueOnce(textResponse("No header response", 200, ""));

    await expect(httpClient("/text")).resolves.toBe("Plain text response");
    await expect(httpClient("/no-header")).resolves.toBe("No header response");
  });

  it("returns API error message from JSON payload", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: "Not found" }, 404));

    await expect(httpClient("/test")).rejects.toThrow("Not found");
  });

  it("falls back to status-based error message when payload has no message", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Internal error" }, 500));
    mockFetch.mockResolvedValueOnce(textResponse("bad gateway", 502, "text/plain"));

    await expect(httpClient("/test-500")).rejects.toThrow("Request failed with status 500");
    await expect(httpClient("/test-502")).rejects.toThrow("Request failed with status 502");
  });

  it("logs unauthorized warning in development", async () => {
    process.env = { ...process.env, NODE_ENV: "development" };
    const infoSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));

    await expect(httpClient("/secure")).rejects.toThrow("Unauthorized");

    expect(warnSpy).toHaveBeenCalledWith("[API]", "Unauthorized access request to:", "/secure");
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("handles timeout aborts with a stable timeout message", async () => {
    jest.useFakeTimers();
    process.env = { ...process.env, NODE_ENV: "development" };
    const infoSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    mockFetch.mockImplementationOnce((_, init) => {
      return new Promise((_, reject) => {
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        const signal = init?.signal as AbortSignal;
        signal.addEventListener("abort", () => reject(abortError));
      }) as Promise<Response>;
    });

    const request = httpClient("/slow", { timeout: 10 });
    jest.advanceTimersByTime(20);

    await expect(request).rejects.toThrow(
      "Request timed out. Server may be starting up, please try again."
    );
    expect(infoSpy).toHaveBeenCalledWith("[API]", "GET /slow");
    expect(errorSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("rethrows network failures and logs errors in development", async () => {
    process.env = { ...process.env, NODE_ENV: "development" };
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const infoSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const networkError = new Error("Network failure");
    mockFetch.mockRejectedValueOnce(networkError);

    await expect(httpClient("/test", { method: "POST", skipAuth: true })).rejects.toThrow(
      "Network failure"
    );

    expect(infoSpy).toHaveBeenCalledWith("[API]", "POST /test");
    expect(errorSpy).toHaveBeenCalledWith("[API]", "API Request Error:", networkError);
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("resolves backend API base URL by environment priority", () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = "https://backend.example.com";
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";
    expect(resolveApiBaseUrl(false)).toBe("https://backend.example.com");

    delete process.env.NEXT_PUBLIC_BACKEND_URL;
    expect(resolveApiBaseUrl(false)).toBe("https://api.example.com");

    delete process.env.NEXT_PUBLIC_API_URL;
    process.env = { ...process.env, NODE_ENV: "production" };
    expect(resolveApiBaseUrl(false)).toBe("");

    process.env = { ...process.env, NODE_ENV: "test" };
    expect(resolveApiBaseUrl(false)).toBe("http://localhost:4000");
    expect(resolveApiBaseUrl(true)).toBe("");
  });
});
