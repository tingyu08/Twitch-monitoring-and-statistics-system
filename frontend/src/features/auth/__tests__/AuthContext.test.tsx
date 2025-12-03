import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuthSession } from "../AuthContext";

// Mock API 函式，避免實際呼叫 /api/auth/me、/api/auth/logout
jest.mock("@/lib/api/auth", () => ({
  getMe: jest.fn(),
  logout: jest.fn(),
}));

const mockGetMe = require("@/lib/api/auth").getMe as jest.Mock;

function Consumer() {
  const { user, loading, error } = useAuthSession();
  return (
    <div>
      <span data-testid="loading">{loading ? "true" : "false"}</span>
      <span data-testid="error">{error ?? ""}</span>
      <span data-testid="user">{user ? user.displayName : ""}</span>
    </div>
  );
}

describe("AuthContext / AuthProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("在載入期間會先顯示 loading=true", () => {
    mockGetMe.mockResolvedValueOnce({
      streamerId: "s1",
      twitchUserId: "t1",
      displayName: "Test User",
      avatarUrl: "https://example.com/avatar.png",
      channelUrl: "https://twitch.tv/test",
    });

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    // 初始 render 時 loading 應為 true
    expect(screen.getByTestId("loading").textContent).toBe("true");
  });

  it("getMe 成功時會設定 user 並結束 loading", async () => {
    mockGetMe.mockResolvedValueOnce({
      streamerId: "s1",
      twitchUserId: "t1",
      displayName: "Test User",
      avatarUrl: "https://example.com/avatar.png",
      channelUrl: "https://twitch.tv/test",
    });

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(screen.getByTestId("user").textContent).toBe("Test User");
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  it("getMe 失敗時會設定 error 並清除 user", async () => {
    mockGetMe.mockRejectedValueOnce(new Error("network error"));

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(screen.getByTestId("user").textContent).toBe("");
    expect(screen.getByTestId("error").textContent).toContain("network error");
  });
}


