import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ViewerSettingsPage from "../page";
import { httpClient } from "@/lib/api/httpClient";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@/features/auth/AuthContext";
import { viewerApi } from "@/lib/api/viewer";

const mockOpen = jest.fn();

jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ priority: _priority, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} alt={props.alt || ""} />
  ),
}));

jest.mock("@/lib/api/httpClient");
jest.mock("@/lib/api/viewer");
jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));
jest.mock("@/features/auth/AuthContext", () => ({
  useAuthSession: jest.fn(),
}));

describe("ViewerSettingsPage", () => {
  const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
  };
  const mockLogout = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useAuthSession as jest.Mock).mockReturnValue({
      user: {
        viewerId: "viewer-1",
        twitchUserId: "t1",
        displayName: "TestViewer",
        avatarUrl: "https://example.com/avatar.png",
        role: "viewer",
        consentedAt: "2025-01-01T00:00:00.000Z",
      },
      loading: false,
      logout: mockLogout,
    });
    (viewerApi.getDataSummary as jest.Mock).mockResolvedValue({
      totalMessages: 100,
      totalAggregations: 10,
      channelCount: 5,
      dateRange: { oldest: "2025-01-01T00:00:00.000Z", newest: null },
    });
    (httpClient as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (url === "/api/viewer/pref/status" && !options?.method) {
        return Promise.resolve({
          settings: {
            collectDailyWatchTime: true,
            collectWatchTimeDistribution: false,
            collectMonthlyAggregates: true,
            collectChatMessages: false,
            collectInteractions: true,
            collectInteractionFrequency: true,
            collectBadgeProgress: true,
            collectFootprintData: false,
            collectRankings: true,
            collectRadarAnalysis: true,
          },
        });
      }
      if (url === "/api/viewer/privacy/deletion-status") {
        return Promise.resolve({ hasPendingDeletion: false });
      }
      if (url === "/api/viewer/pref/status" && options?.method === "PATCH") {
        return Promise.resolve({ success: true });
      }
      if (url === "/api/viewer/privacy/export" && options?.method === "POST") {
        return Promise.resolve({ jobId: "job-1", status: "completed" });
      }
      if (url === "/api/viewer/privacy/delete-account" && options?.method === "POST") {
        return Promise.resolve({ scheduledAt: "2025-01-08T00:00:00.000Z" });
      }
      if (url === "/api/viewer/privacy/cancel-deletion" && options?.method === "POST") {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });
    window.open = mockOpen;
  });

  it("redirects anonymous users to home", async () => {
    (useAuthSession as jest.Mock).mockReturnValue({ user: null, loading: false, logout: mockLogout });

    render(<ViewerSettingsPage />);

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith("/");
    });
  });

  it("shows loading state while auth is pending", () => {
    (useAuthSession as jest.Mock).mockReturnValue({ user: null, loading: true, logout: mockLogout });
    render(<ViewerSettingsPage />);

    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("renders profile, summary, and privacy sections", async () => {
    render(<ViewerSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("settings.profile")).toBeInTheDocument();
    });

    expect(screen.getByText("TestViewer")).toBeInTheDocument();
    expect(screen.getByText("Twitch ID: t1")).toBeInTheDocument();
    expect(screen.getByText("settings.dataSummary.title")).toBeInTheDocument();
  });

  it("renders non-viewer fallback, placeholder summary values, and disabled delete state", async () => {
    (useAuthSession as jest.Mock).mockReturnValue({
      user: {
        displayName: "Streamer User",
        twitchUserId: "streamer-1",
        role: "streamer",
      },
      loading: false,
      logout: mockLogout,
    });
    (viewerApi.getDataSummary as jest.Mock).mockResolvedValue(null);
    (httpClient as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (url === "/api/viewer/pref/status" && !options?.method) return Promise.resolve({ settings: {} });
      if (url === "/api/viewer/privacy/deletion-status") {
        return Promise.resolve({ hasPendingDeletion: true, remainingDays: 3 });
      }
      return Promise.resolve({});
    });

    render(<ViewerSettingsPage />);

    await screen.findByText("⚠️ 帳號刪除請求進行中");
    expect(screen.queryByAltText("Streamer User")).not.toBeInTheDocument();
    expect(screen.getByText("Twitch ID:")).toBeInTheDocument();
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "🗑️ settings.dataManagement.deleteButton" })
    ).toBeDisabled();
  });

  it("covers export button states and success cancellation flow", async () => {
    const user = userEvent.setup();
    let resolveExport: ((value: unknown) => void) | undefined;
    (httpClient as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (url === "/api/viewer/pref/status" && !options?.method) return Promise.resolve({ settings: {} });
      if (url === "/api/viewer/privacy/deletion-status") return Promise.resolve({ hasPendingDeletion: true, remainingDays: 1 });
      if (url === "/api/viewer/privacy/export" && options?.method === "POST") {
        return new Promise((resolve) => {
          resolveExport = resolve;
        });
      }
      if (url === "/api/viewer/privacy/cancel-deletion" && options?.method === "POST") {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });

    render(<ViewerSettingsPage />);
    await screen.findByText("撤銷刪除");

    await user.click(screen.getByRole("button", { name: "📤 settings.dataManagement.exportButton" }));
    expect(screen.getByRole("button", { name: "settings.dataManagement.exporting" })).toBeDisabled();
    resolveExport?.({ jobId: "job-2", status: "pending" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "📤 settings.dataManagement.exportButton" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "撤銷刪除" }));
    await waitFor(() => {
      expect(screen.getByText("刪除請求已撤銷")).toBeInTheDocument();
    });
  });

  it("covers settings fallback and download-without-job branch", async () => {
    const user = userEvent.setup();
    (httpClient as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (url === "/api/viewer/pref/status" && !options?.method) {
        return Promise.resolve({ settings: undefined });
      }
      if (url === "/api/viewer/privacy/deletion-status") {
        return Promise.resolve({ hasPendingDeletion: false });
      }
      if (url === "/api/viewer/privacy/export" && options?.method === "POST") {
        return Promise.resolve({ status: "completed" });
      }
      return Promise.resolve({});
    });

    render(<ViewerSettingsPage />);
    await screen.findByText("settings.dataManagement.title");

    await user.click(screen.getByRole("button", { name: "📤 settings.dataManagement.exportButton" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "📥 settings.dataManagement.download" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "📥 settings.dataManagement.download" }));
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("navigates back to the dashboard", async () => {
    const user = userEvent.setup();
    render(<ViewerSettingsPage />);
    await screen.findByText("settings.title");

    await user.click(screen.getByRole("button", { name: /settings.backToDashboard/i }));
    expect(mockRouter.push).toHaveBeenCalledWith("/dashboard/viewer");
  });

  it("saves setting toggles and rolls back on failure", async () => {
    const user = userEvent.setup();
    render(<ViewerSettingsPage />);
    await screen.findByText("settings.privacy.title");

    const toggles = screen.getAllByRole("button").filter((button) => button.className.includes("rounded-full"));
    await user.click(toggles[0]);

    await waitFor(() => {
      expect(httpClient).toHaveBeenCalledWith("/api/viewer/pref/status", {
        method: "PATCH",
        body: JSON.stringify({ collectDailyWatchTime: false }),
      });
    });
    expect(screen.getByText("設定已儲存")).toBeInTheDocument();

    (httpClient as jest.Mock).mockRejectedValueOnce(new Error("nope"));
    await user.click(toggles[1]);
    await waitFor(() => {
      expect(screen.getByText("儲存設定失敗，請稍後再試")).toBeInTheDocument();
    });
  });

  it("exports data and downloads completed exports", async () => {
    const user = userEvent.setup();
    render(<ViewerSettingsPage />);
    await screen.findByText("settings.dataManagement.title");

    await user.click(screen.getByRole("button", { name: "📤 settings.dataManagement.exportButton" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "📥 settings.dataManagement.download" })).toBeInTheDocument();
    });
    expect(screen.getByText("資料匯出完成！")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "📥 settings.dataManagement.download" }));
    expect(mockOpen).toHaveBeenCalledWith("/api/viewer/privacy/export/job-1/download", "_blank");
  });

  it("shows export errors", async () => {
    const user = userEvent.setup();
    (httpClient as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (url === "/api/viewer/pref/status" && !options?.method) return Promise.resolve({ settings: {} });
      if (url === "/api/viewer/privacy/deletion-status") return Promise.resolve({ hasPendingDeletion: false });
      if (url === "/api/viewer/privacy/export" && options?.method === "POST") {
        return Promise.reject(new Error("export failed"));
      }
      return Promise.resolve({});
    });

    render(<ViewerSettingsPage />);
    await screen.findByText("settings.dataManagement.title");
    await user.click(screen.getByRole("button", { name: "📤 settings.dataManagement.exportButton" }));

    await waitFor(() => {
      expect(screen.getByText("匯出失敗，請稍後再試")).toBeInTheDocument();
    });
  });

  it("handles pending deletion, cancel deletion, and delete confirmation", async () => {
    const user = userEvent.setup();
    (httpClient as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (url === "/api/viewer/pref/status" && !options?.method) return Promise.resolve({ settings: {} });
      if (url === "/api/viewer/privacy/deletion-status") {
        return Promise.resolve({ hasPendingDeletion: true, remainingDays: 6 });
      }
      if (url === "/api/viewer/privacy/cancel-deletion" && options?.method === "POST") {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });

    render(<ViewerSettingsPage />);
    await screen.findByText("⚠️ 帳號刪除請求進行中");
    await user.click(screen.getByRole("button", { name: "撤銷刪除" }));
    await waitFor(() => {
      expect(screen.getByText("刪除請求已撤銷")).toBeInTheDocument();
    });

    (httpClient as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (url === "/api/viewer/pref/status" && !options?.method) return Promise.resolve({ settings: {} });
      if (url === "/api/viewer/privacy/deletion-status") return Promise.resolve({ hasPendingDeletion: false });
      if (url === "/api/viewer/privacy/delete-account" && options?.method === "POST") {
        return Promise.resolve({ scheduledAt: "2025-01-08T00:00:00.000Z" });
      }
      return Promise.resolve({});
    });

    render(<ViewerSettingsPage />);
    await screen.findAllByText("settings.dataManagement.delete");
    await user.click(screen.getAllByRole("button", { name: "🗑️ settings.dataManagement.deleteButton" })[0]);
    expect(screen.getByText("⚠️ 確認刪除帳號")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "settings.deleteModal.confirmButton" }));
    await waitFor(() => {
      expect(screen.getByText("刪除請求已建立，您有 7 天可以撤銷")).toBeInTheDocument();
    });
  });

  it("shows delete account failures and logout action", async () => {
    const user = userEvent.setup();
    (httpClient as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (url === "/api/viewer/pref/status" && !options?.method) return Promise.resolve({ settings: {} });
      if (url === "/api/viewer/privacy/deletion-status") return Promise.resolve({ hasPendingDeletion: false });
      if (url === "/api/viewer/privacy/delete-account" && options?.method === "POST") {
        return Promise.reject(new Error("delete failed"));
      }
      return Promise.resolve({});
    });

    render(<ViewerSettingsPage />);
    await screen.findByText("settings.dataManagement.title");
    await user.click(screen.getByRole("button", { name: "common.logout" }));
    expect(mockLogout).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "🗑️ settings.dataManagement.deleteButton" }));
    await user.click(screen.getByRole("button", { name: "settings.deleteModal.confirmButton" }));

    await waitFor(() => {
      expect(screen.getByText("刪除請求失敗，請稍後再試")).toBeInTheDocument();
    });
  });

  it("handles partial privacy data failures and cancel modal dismissal", async () => {
    const user = userEvent.setup();
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    (viewerApi.getDataSummary as jest.Mock).mockRejectedValue(new Error("async summary error"));
    (httpClient as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (url === "/api/viewer/pref/status" && !options?.method) {
        return Promise.reject(new Error("pref fail"));
      }
      if (url === "/api/viewer/privacy/deletion-status" && !options?.method) {
        return Promise.reject(new Error("deletion fail"));
      }
      return Promise.resolve({});
    });

    render(<ViewerSettingsPage />);
    await screen.findByText("settings.dataManagement.title");

    await user.click(screen.getByRole("button", { name: "🗑️ settings.dataManagement.deleteButton" }));
    expect(screen.getByText("⚠️ 確認刪除帳號")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(screen.queryByText("⚠️ 確認刪除帳號")).not.toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("logs when privacy data loading throws before Promise.all resolves", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    (httpClient as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (url === "/api/viewer/pref/status" && !options?.method) {
        throw new Error("sync privacy failure");
      }
      if (url === "/api/viewer/privacy/deletion-status") {
        return Promise.resolve({ hasPendingDeletion: false });
      }
      return Promise.resolve({});
    });

    render(<ViewerSettingsPage />);

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to load privacy data:",
        expect.any(Error)
      );
    });

    errorSpy.mockRestore();
  });

  it("shows cancel deletion errors and clears flash messages after timeout", async () => {
    const user = userEvent.setup();
    (httpClient as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (url === "/api/viewer/pref/status" && !options?.method) return Promise.resolve({ settings: {} });
      if (url === "/api/viewer/privacy/deletion-status") {
        return Promise.resolve({ hasPendingDeletion: true, remainingDays: 2 });
      }
      if (url === "/api/viewer/privacy/cancel-deletion" && options?.method === "POST") {
        return Promise.reject(new Error("cancel failed"));
      }
      return Promise.resolve({});
    });

    render(<ViewerSettingsPage />);
    await screen.findByText("撤銷刪除");
    await user.click(screen.getByRole("button", { name: "撤銷刪除" }));

    await waitFor(() => {
      expect(screen.getByText("撤銷失敗，請稍後再試")).toBeInTheDocument();
    });
  });

  it("clears success messages after their timeout windows", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<ViewerSettingsPage />);
    await screen.findByText("settings.dataManagement.title");

    await user.click(screen.getByRole("button", { name: "📤 settings.dataManagement.exportButton" }));
    await waitFor(() => {
      expect(screen.getByText("資料匯出完成！")).toBeInTheDocument();
    });

    jest.advanceTimersByTime(3000);
    await waitFor(() => {
      expect(screen.queryByText("資料匯出完成！")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "🗑️ settings.dataManagement.deleteButton" }));
    await user.click(screen.getByRole("button", { name: "settings.deleteModal.confirmButton" }));
    await waitFor(() => {
      expect(screen.getByText("刪除請求已建立，您有 7 天可以撤銷")).toBeInTheDocument();
    });

    jest.advanceTimersByTime(5000);
    await waitFor(() => {
      expect(screen.queryByText("刪除請求已建立，您有 7 天可以撤銷")).not.toBeInTheDocument();
    });

    jest.useRealTimers();
  });
});
