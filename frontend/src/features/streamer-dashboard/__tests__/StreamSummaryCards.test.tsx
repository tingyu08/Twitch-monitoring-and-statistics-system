import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StreamSummaryCards } from '../components/StreamSummaryCards';
import * as streamerApi from '@/lib/api/streamer';

// Mock streamer API
jest.mock('@/lib/api/streamer');

describe('StreamSummaryCards', () => {
  const mockSummary = {
    range: '30d',
    totalStreamHours: 10.5,
    totalStreamSessions: 5,
    avgStreamDurationMinutes: 126,
    isEstimated: false,
  };

  // 用於控制 pending promise 的 resolver
  let pendingResolvers: Array<(value: any) => void> = [];

  beforeEach(() => {
    jest.clearAllMocks();
    pendingResolvers = [];
  });

  afterEach(async () => {
    // 解決所有 pending promises 以避免 act() 警告
    pendingResolvers.forEach((resolve) => resolve(mockSummary));
    pendingResolvers = [];
    
    // 確保所有非同步狀態更新完成
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    
    cleanup();
  });

  it('應該在載入時顯示 skeleton 狀態', async () => {
    (streamerApi.getStreamerSummary as jest.Mock).mockImplementation(
      () => new Promise((resolve) => {
        pendingResolvers.push(resolve);
      })
    );

    render(<StreamSummaryCards />);

    // 檢查是否有 animate-pulse 類別（skeleton 狀態）
    const skeletonElements = document.querySelectorAll('.animate-pulse');
    expect(skeletonElements.length).toBeGreaterThan(0);
  });

  it('應該成功載入並顯示統計數據', async () => {
    (streamerApi.getStreamerSummary as jest.Mock).mockResolvedValue(mockSummary);

    render(<StreamSummaryCards />);

    await waitFor(() => {
      expect(screen.getByText('10.5')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('126')).toBeInTheDocument();
    });

    // 驗證標題
    expect(screen.getByText('summary.totalHours')).toBeInTheDocument();
    expect(screen.getByText('summary.totalSessions')).toBeInTheDocument();
    expect(screen.getByText('summary.avgDuration')).toBeInTheDocument();
  });

  it('應該在無資料時顯示空狀態', async () => {
    const emptySummary = {
      ...mockSummary,
      totalStreamHours: 0,
      totalStreamSessions: 0,
      avgStreamDurationMinutes: 0,
    };
    (streamerApi.getStreamerSummary as jest.Mock).mockResolvedValue(emptySummary);

    render(<StreamSummaryCards />);

    await waitFor(() => {
      expect(screen.getByText('noStreamData')).toBeInTheDocument();
    });
  });

  it('應該在錯誤時顯示錯誤訊息', async () => {
    (streamerApi.getStreamerSummary as jest.Mock).mockRejectedValue(
      new Error('載入統計資料失敗')
    );

    render(<StreamSummaryCards />);

    // Wait for error state to be set and loading to complete
    await waitFor(() => {
      expect(screen.getByText(/載入統計資料失敗/)).toBeInTheDocument();
    });

    // Ensure all state updates have settled
    await waitFor(() => {
      expect(screen.queryByText('summary.totalHours')).not.toBeInTheDocument();
    });
  });

  it('應該在切換時間範圍時重新載入資料', async () => {
    const user = userEvent.setup();
    (streamerApi.getStreamerSummary as jest.Mock).mockResolvedValue(mockSummary);

    render(<StreamSummaryCards />);

    // 等待初始載入完成
    await waitFor(() => {
      expect(screen.getByText('10.5')).toBeInTheDocument();
    });

    // 點擊 7 天選項（實際按鈕文字是 "最近 7 天"）
    const button7d = screen.getByText('recent7');
    await user.click(button7d);

    // 驗證 API 被呼叫兩次：一次是初始 30d，一次是切換到 7d
    await waitFor(() => {
      expect(streamerApi.getStreamerSummary).toHaveBeenCalledTimes(2);
    });
    expect(streamerApi.getStreamerSummary).toHaveBeenLastCalledWith('7d');
  });

  it('應該在資料為估算值時顯示警告標籤', async () => {
    const estimatedSummary = { ...mockSummary, isEstimated: true };
    (streamerApi.getStreamerSummary as jest.Mock).mockResolvedValue(estimatedSummary);

    render(<StreamSummaryCards />);

    await waitFor(() => {
      // 檢查是否有 "估算" 文字
      expect(screen.getAllByText(/估算/).length).toBeGreaterThan(0);
    });
  });

  it('應該預設顯示 30 天範圍', async () => {
    (streamerApi.getStreamerSummary as jest.Mock).mockResolvedValue(mockSummary);

    render(<StreamSummaryCards />);

    expect(streamerApi.getStreamerSummary).toHaveBeenCalledWith('30d');
    
    // 等待狀態更新完成
    await waitFor(() => {
      expect(screen.getByText('10.5')).toBeInTheDocument();
    });
  });

  it('應該正確處理載入狀態轉換', async () => {
    let resolvePromise: (value: any) => void;
    (streamerApi.getStreamerSummary as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
          pendingResolvers.push(resolve);
        })
    );

    render(<StreamSummaryCards />);

    // 初始為載入狀態
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);

    // 解決 Promise
    await act(async () => {
      resolvePromise!(mockSummary);
    });

    // 等待載入完成
    await waitFor(() => {
      expect(screen.getByText('10.5')).toBeInTheDocument();
    });

    // 確認不再是載入狀態
    expect(document.querySelectorAll('.animate-pulse').length).toBe(0);
  });
});
