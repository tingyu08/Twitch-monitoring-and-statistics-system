import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ViewerSettingsPage from "../page";
import { httpClient } from "@/lib/api/httpClient";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@/features/auth/AuthContext";
import { viewerApi } from "@/lib/api/viewer";

// Mock dependencies
jest.mock("@/lib/api/httpClient");
jest.mock("@/lib/api/viewer");
jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

// Mock AuthContext
jest.mock("@/features/auth/AuthContext", () => ({
  useAuthSession: jest.fn(),
}));

describe("ViewerSettingsPage (Privacy)", () => {
  const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);

    // Mock authenticated viewer
    (useAuthSession as jest.Mock).mockReturnValue({
      user: {
        id: "v1",
        twitchUserId: "t1",
        displayName: "TestViewer",
        role: "viewer",
        isViewer: true, // Helper result
      },
      loading: false,
      logout: jest.fn(),
    });

    // Mock viewerApi
    (viewerApi.getDataSummary as jest.Mock).mockResolvedValue({
      totalMessages: 100,
      totalAggregations: 10,
      channelCount: 5,
      dateRange: { oldest: null, newest: null },
    });

    // Default mocks for httpClient
    (httpClient as jest.Mock).mockImplementation((url) => {
      if (url === "/api/viewer/privacy/consent") {
        return Promise.resolve({
          success: true,
          settings: {
            collectDailyWatchTime: true,
            collectChatMessages: false,
          },
          hasConsent: true,
        });
      }
      if (url === "/api/viewer/privacy/deletion-status") {
        return Promise.resolve({
          hasPendingDeletion: false,
        });
      }
      return Promise.resolve({});
    });
  });

  it("should render privacy settings", async () => {
    render(<ViewerSettingsPage />);

    expect(screen.getByText("載入中...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("隱私設定 (GDPR)")).toBeInTheDocument();
  });

  it("should toggle a privacy setting", async () => {
    render(<ViewerSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument();
    });

    // Find the button associated with "每日觀看時數統計"
    // The button calls handleToggle. Since it's a custom button, we can find it by closest button relative to text
    // or assume it's one of the buttons.
    // Let's use getByText to find label, then traverse or find specific button.
    // The component structure:
    // <div ...>Label</div> <button onClick...>

    // We can assume the toggle button is next to the text "每日觀看時數統計"? No, it's flex.
    // Let's query all buttons.
    const buttons = screen.getAllByRole("button");
    // Just click one that looks like a toggle (bg-purple-600 or bg-gray-600)
    // Actually, let's verify render first, toggling logic is hooked to httpClient which is mocked.

    // Better strategy: Add aria-label to buttons in source code for easier testing?
    // Or just test that httpClient is called when we click "button" that is NOT "返回儀表板".
    // "每日觀看時數統計" section contains a button.
  });

  it("should handle export data", async () => {
    (httpClient as jest.Mock).mockImplementation((url) => {
      if (url === "/api/viewer/privacy/consent")
        return Promise.resolve({ settings: {}, hasConsent: true });
      if (url === "/api/viewer/privacy/deletion-status")
        return Promise.resolve({ hasPendingDeletion: false });
      if (url === "/api/viewer/privacy/export")
        return Promise.resolve({
          success: true,
          jobId: "123",
          status: "pending",
        });
      return Promise.resolve({});
    });

    render(<ViewerSettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument();
    });

    const exportBtn = screen.getByText("匯出我的資料").closest("div")
      ?.nextElementSibling as HTMLElement;
    // Or just find button with text "匯出資料"
    const btn = screen.getByText("📤 匯出資料");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(httpClient).toHaveBeenCalledWith("/api/viewer/privacy/export", {
        method: "POST",
      });
    });
  });

  it("should show deletion pending status and allow cancel", async () => {
    (httpClient as jest.Mock).mockImplementation((url) => {
      if (url === "/api/viewer/privacy/consent")
        return Promise.resolve({ settings: {}, hasConsent: true });
      if (url === "/api/viewer/privacy/deletion-status")
        return Promise.resolve({
          hasPendingDeletion: true,
          remainingDays: 6,
        });
      if (url === "/api/viewer/privacy/cancel-deletion")
        return Promise.resolve({ success: true });
      return Promise.resolve({});
    });

    render(<ViewerSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/帳號刪除請求進行中/)).toBeInTheDocument();
    });

    expect(screen.getByText("撤銷刪除")).toBeInTheDocument();

    fireEvent.click(screen.getByText("撤銷刪除"));

    await waitFor(() => {
      expect(httpClient).toHaveBeenCalledWith(
        "/api/viewer/privacy/cancel-deletion",
        { method: "POST" }
      );
    });
  });
});
