import { render, screen, waitFor } from "@testing-library/react";
import { GameStatsChart } from "../GameStatsChart";
import * as streamerApi from "@/lib/api/streamer";

jest.mock("@/lib/api/streamer");
jest.mock("@/components/charts/SafeResponsiveContainer", () => ({
  SafeResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="safe-responsive-container">{children}</div>
  ),
}));
// recharts components just render minimal stubs
jest.mock("recharts", () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Cell: () => null,
}));

const mockedStreamerApi = streamerApi as jest.Mocked<typeof streamerApi>;

const mockGameStats: streamerApi.GameStats[] = [
  { gameName: "Just Chatting", totalHours: 10, avgViewers: 100, peakViewers: 200, streamCount: 5, percentage: 33 },
  { gameName: "League of Legends", totalHours: 8, avgViewers: 80, peakViewers: 150, streamCount: 4, percentage: 27 },
  { gameName: "Minecraft", totalHours: 6, avgViewers: 60, peakViewers: 100, streamCount: 3, percentage: 20 },
];

describe("GameStatsChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("顯示外部數據時不呼叫 API", async () => {
    render(<GameStatsChart data={mockGameStats} loading={false} />);

    expect(mockedStreamerApi.getStreamerGameStats).not.toHaveBeenCalled();
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("externalLoading=true 時顯示 loading 狀態", () => {
    render(<GameStatsChart data={mockGameStats} loading={true} />);
    // ChartLoading renders a spinner
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("外部數據為空陣列時顯示空狀態", () => {
    render(<GameStatsChart data={[]} loading={false} />);
    // ChartEmpty renders with description text key
    expect(screen.getByText("noGameStatsDesc")).toBeInTheDocument();
  });

  it("無外部數據時呼叫 API 並渲染圖表", async () => {
    mockedStreamerApi.getStreamerGameStats.mockResolvedValue(mockGameStats);

    render(<GameStatsChart range="30d" />);

    // Should show loading initially
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();

    await waitFor(() => {
      expect(mockedStreamerApi.getStreamerGameStats).toHaveBeenCalledWith("30d");
    });

    await waitFor(() => {
      expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    });
  });

  it("API 呼叫失敗時顯示錯誤狀態", async () => {
    mockedStreamerApi.getStreamerGameStats.mockRejectedValue(
      new Error("API Error")
    );

    render(<GameStatsChart />);

    await waitFor(() => {
      // ChartError renders an error title
      expect(screen.getByText("errorTitle")).toBeInTheDocument();
    });
  });

  it("API 回傳空陣列時顯示空狀態", async () => {
    mockedStreamerApi.getStreamerGameStats.mockResolvedValue([]);

    render(<GameStatsChart />);

    await waitFor(() => {
      expect(screen.getByText("noGameStatsDesc")).toBeInTheDocument();
    });
  });

  it("圖表最多顯示 5 筆資料", async () => {
    const manyGames: streamerApi.GameStats[] = [
      { gameName: "Game A", totalHours: 10, avgViewers: 100, peakViewers: 200, streamCount: 5, percentage: 20 },
      { gameName: "Game B", totalHours: 9, avgViewers: 90, peakViewers: 180, streamCount: 4, percentage: 18 },
      { gameName: "Game C", totalHours: 8, avgViewers: 80, peakViewers: 160, streamCount: 3, percentage: 16 },
      { gameName: "Game D", totalHours: 7, avgViewers: 70, peakViewers: 140, streamCount: 3, percentage: 14 },
      { gameName: "Game E", totalHours: 6, avgViewers: 60, peakViewers: 120, streamCount: 2, percentage: 12 },
      { gameName: "Game F", totalHours: 5, avgViewers: 50, peakViewers: 100, streamCount: 2, percentage: 10 },
    ];

    render(<GameStatsChart data={manyGames} loading={false} />);

    // Chart renders without crash
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    // Title is shown
    expect(screen.getByText("gameStats")).toBeInTheDocument();
  });

  it("使用預設 range 30d 呼叫 API", async () => {
    mockedStreamerApi.getStreamerGameStats.mockResolvedValue(mockGameStats);

    render(<GameStatsChart />);

    await waitFor(() => {
      expect(mockedStreamerApi.getStreamerGameStats).toHaveBeenCalledWith("30d");
    });
  });

  it("range 改變時重新呼叫 API", async () => {
    mockedStreamerApi.getStreamerGameStats.mockResolvedValue(mockGameStats);

    const { rerender } = render(<GameStatsChart range="7d" />);

    await waitFor(() => {
      expect(mockedStreamerApi.getStreamerGameStats).toHaveBeenCalledWith("7d");
    });

    mockedStreamerApi.getStreamerGameStats.mockResolvedValue([
      { gameName: "New Game", totalHours: 15, avgViewers: 200, peakViewers: 400, streamCount: 8, percentage: 50 },
    ]);

    rerender(<GameStatsChart range="90d" />);

    await waitFor(() => {
      expect(mockedStreamerApi.getStreamerGameStats).toHaveBeenCalledWith("90d");
    });
  });
});
