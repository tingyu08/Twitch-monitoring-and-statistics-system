import { getMe, isStreamer, isViewer, logout } from "../auth";
import { httpClient } from "../httpClient";

jest.mock("../httpClient");

const mockHttpClient = httpClient as jest.MockedFunction<typeof httpClient>;

describe("auth.ts", () => {
  const streamerUser = {
    role: "streamer" as const,
    streamerId: "123",
    twitchUserId: "tw123",
    displayName: "TestStreamer",
    avatarUrl: "https://example.com/avatar.jpg",
    channelUrl: "https://twitch.tv/teststreamer",
  };

  const viewerUser = {
    role: "viewer" as const,
    viewerId: "viewer-1",
    twitchUserId: "tw-viewer",
    displayName: "TestViewer",
    avatarUrl: "https://example.com/viewer.jpg",
    consentedAt: null,
    consentVersion: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    global.fetch = jest.fn();
  });

  describe("type guards", () => {
    it("isStreamer should return true only for streamer role", () => {
      expect(isStreamer(streamerUser)).toBe(true);
      expect(isStreamer(viewerUser)).toBe(false);
    });

    it("isViewer should return true for viewer role", () => {
      expect(isViewer(viewerUser)).toBe(true);
    });

    it("isViewer should return false for streamer without viewerId", () => {
      expect(isViewer(streamerUser)).toBe(false);
    });

    it("isViewer should return true for streamer with viewerId", () => {
      expect(isViewer({ ...streamerUser, viewerId: "viewer-as-streamer" })).toBe(
        true,
      );
    });
  });

  describe("getMe", () => {
    it("should call httpClient with correct endpoint", async () => {
      mockHttpClient.mockResolvedValueOnce(streamerUser);

      const result = await getMe();

      expect(mockHttpClient).toHaveBeenCalledWith("/api/auth/me", {
        silentStatuses: [401],
      });
      expect(result).toEqual(streamerUser);
    });

    it("should return nested user when response shape is { user }", async () => {
      mockHttpClient.mockResolvedValueOnce({ user: viewerUser });

      await expect(getMe()).resolves.toEqual(viewerUser);
    });

    it("should throw for invalid response payload", async () => {
      mockHttpClient.mockResolvedValueOnce({} as never);

      await expect(getMe()).rejects.toThrow("Invalid response from server");
    });

    it("should propagate errors from httpClient", async () => {
      const error = new Error("Network error");
      mockHttpClient.mockRejectedValueOnce(error);

      await expect(getMe()).rejects.toThrow("Network error");
    });

    it("should block while logout_pending is true and clear marker after successful logout", async () => {
      localStorage.setItem("logout_pending", "true");
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ message: "Logged out successfully" }),
      } as Response);

      await expect(getMe()).rejects.toThrow("Logging out");

      expect(global.fetch).toHaveBeenCalledWith("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      expect(localStorage.getItem("logout_pending")).toBeNull();
      expect(mockHttpClient).not.toHaveBeenCalled();
    });

    it("should keep logout_pending marker when logout attempt fails", async () => {
      localStorage.setItem("logout_pending", "true");
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(getMe()).rejects.toThrow("Logging out");

      expect(localStorage.getItem("logout_pending")).toBe("true");
      expect(mockHttpClient).not.toHaveBeenCalled();
    });
  });

  describe("logout", () => {
    it("should call fetch with correct endpoint and method", async () => {
      const mockResponse = { message: "Logged out successfully" };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as Response);

      const result = await logout();

      expect(global.fetch).toHaveBeenCalledWith("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      expect(result).toEqual(mockResponse);
    });

    it("should throw when response is not ok", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(logout()).rejects.toThrow("Request failed with status 500");
    });

    it("should propagate fetch rejection", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Fetch failed"));

      await expect(logout()).rejects.toThrow("Fetch failed");
    });
  });
});
