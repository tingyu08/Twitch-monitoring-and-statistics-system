/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";


// Mock AuthContext
const mockUseAuthSession = jest.fn();
jest.mock("@/features/auth/AuthContext", () => ({
  useAuthSession: () => mockUseAuthSession(),
}));

// Mock next/navigation
const mockPush = jest.fn();
const mockGet = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useSearchParams: () => ({
    get: mockGet,
  }),
  usePathname: () => "/en",
  useParams: () => ({ locale: "en" }),
}));

// 在測試前需要 import，這樣 mock 才會生效
import LandingPage from "../[locale]/page";

describe("LandingPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockReturnValue(null); // 預設無錯誤
  });

  describe("未登入狀態", () => {
    beforeEach(() => {
      mockUseAuthSession.mockReturnValue({
        user: null,
        loading: false,
        error: null,
        logout: jest.fn(),
        refresh: jest.fn(),
        isStreamer: false,
        isViewer: false,
      });
    });

    it("顯示單一登入按鈕", async () => {
      render(<LandingPage />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "home.loginButton" })).toBeInTheDocument();
      });
    });

    it("顯示正確的標題和說明", async () => {
      render(<LandingPage />);

      await waitFor(() => {
        expect(screen.getByText("home.title")).toBeInTheDocument();
        expect(screen.getByText("home.description")).toBeInTheDocument();
      });
    });
  });

  describe("載入中狀態", () => {
    beforeEach(() => {
      mockUseAuthSession.mockReturnValue({
        user: null,
        loading: true,
        error: null,
        logout: jest.fn(),
        refresh: jest.fn(),
        isStreamer: false,
        isViewer: false,
      });
    });

    it("顯示載入中訊息", async () => {
      render(<LandingPage />);

      await waitFor(() => {
        expect(screen.getByText("common.loading")).toBeInTheDocument();
      });
    });
  });

  describe("錯誤狀態", () => {
    beforeEach(() => {
      mockUseAuthSession.mockReturnValue({
        user: null,
        loading: false,
        error: null,
        logout: jest.fn(),
        refresh: jest.fn(),
        isStreamer: false,
        isViewer: false,
      });
    });

    it("當有 authError 時顯示錯誤訊息", async () => {
      mockGet.mockReturnValue("authorization_failed");

      render(<LandingPage />);

      await waitFor(() => {
        expect(screen.getByText("home.loginFailed")).toBeInTheDocument();
        expect(screen.getByText("home.authErrors.authorizationFailed")).toBeInTheDocument();
      });
    });
  });

  describe("已登入狀態", () => {
    beforeEach(() => {
      mockUseAuthSession.mockReturnValue({
        user: {
          streamerId: "s1",
          twitchUserId: "t1",
          displayName: "Test User",
          avatarUrl: "https://example.com/avatar.png",
          channelUrl: "https://twitch.tv/test",
          role: "streamer",
        },
        loading: false,
        error: null,
        logout: jest.fn(),
        refresh: jest.fn(),
        isStreamer: true,
        isViewer: false,
      });
    });

    it("已登入應導向到觀眾儀表板", async () => {
      render(<LandingPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/en/dashboard/viewer");
      });
    });
  });
});
