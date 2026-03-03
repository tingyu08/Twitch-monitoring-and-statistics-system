import { act, renderHook, waitFor } from "@testing-library/react";

import { httpClient } from "@/lib/api/httpClient";
import { useExtensionSync } from "../useExtensionSync";

jest.mock("@/lib/api/httpClient", () => ({
  httpClient: jest.fn(),
}));

const mockedHttpClient = httpClient as jest.MockedFunction<typeof httpClient>;

describe("useExtensionSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("registers and cleans up the message listener", () => {
    const addEventListenerSpy = jest.spyOn(window, "addEventListener");
    const removeEventListenerSpy = jest.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useExtensionSync(null));

    expect(addEventListenerSpy).toHaveBeenCalledWith("message", expect.any(Function));
    const messageHandler = addEventListenerSpy.mock.calls.find((call) => call[0] === "message")?.[1];

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("message", messageHandler);
  });

  it("handles extension message events from window", () => {
    const includesSpy = jest.spyOn(Array.prototype, "includes").mockReturnValue(true);
    const { result } = renderHook(() => useExtensionSync(null));

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: { type: "BMAD_EXTENSION_READY" },
        })
      );
    });

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.isConnected).toBe(false);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: { type: "BMAD_SYNC_SUCCESS" },
        })
      );
    });

    expect(result.current.isConnected).toBe(true);

    includesSpy.mockRestore();
  });

  it("ignores events with non-window source and non-allowed origin", () => {
    const { result } = renderHook(() => useExtensionSync(null));

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: null,
          data: { type: "BMAD_EXTENSION_READY" },
        })
      );
    });

    expect(result.current.isInstalled).toBe(false);

    const includesSpy = jest.spyOn(Array.prototype, "includes").mockReturnValue(false);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: { type: "BMAD_EXTENSION_READY" },
        })
      );
    });

    expect(result.current.isInstalled).toBe(false);
    expect(result.current.isConnected).toBe(false);

    includesSpy.mockRestore();
  });

  it("syncToExtension fetches token and posts message", async () => {
    mockedHttpClient.mockResolvedValue({ token: "test-jwt", expiresIn: 3600 });
    const postMessageSpy = jest.spyOn(window, "postMessage");
    const { result } = renderHook(() => useExtensionSync(null));

    await act(async () => {
      await result.current.syncToExtension();
    });

    expect(mockedHttpClient).toHaveBeenCalledWith("/api/sync/auth-token", {
      method: "POST",
    });
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: "BMAD_SYNC_TOKEN",
        token: "test-jwt",
      },
      window.location.origin
    );
  });

  it("syncToExtension logs errors and does not throw", async () => {
    mockedHttpClient.mockRejectedValue(new Error("token error"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useExtensionSync(null));

    await act(async () => {
      await expect(result.current.syncToExtension()).resolves.toBeUndefined();
    });

    expect(errorSpy).toHaveBeenCalledWith(
      "[Bmad] Failed to fetch extension token:",
      expect.any(Error)
    );
  });

  it("auto-syncs when user is logged in and extension becomes installed", async () => {
    const includesSpy = jest.spyOn(Array.prototype, "includes").mockReturnValue(true);
    mockedHttpClient.mockResolvedValue({ token: "auto-jwt", expiresIn: 3600 });

    const { result } = renderHook(({ userId }) => useExtensionSync(userId), {
      initialProps: { userId: "viewer-123" as string | null },
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: { type: "BMAD_EXTENSION_READY" },
        })
      );
    });

    await waitFor(() => {
      expect(result.current.isInstalled).toBe(true);
      expect(mockedHttpClient).toHaveBeenCalledWith("/api/sync/auth-token", {
        method: "POST",
      });
    });

    includesSpy.mockRestore();
  });
});
