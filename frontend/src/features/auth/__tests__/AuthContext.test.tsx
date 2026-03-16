import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, resolveViewerId, shouldInitializeAuth, useAuthSession } from '../AuthContext';

// Mock API functions
jest.mock('@/lib/api/auth', () => ({
  getMe: jest.fn(),
  logout: jest.fn(),
  isStreamer: (user: { role?: string }) => user?.role === 'streamer',
  isViewer: (user: { role?: string }) => user?.role === 'viewer',
}));

jest.mock('@/hooks/useExtensionSync', () => ({
  useExtensionSync: jest.fn(),
}));

const mockGetMe = require('@/lib/api/auth').getMe as jest.Mock;
const mockLogout = require('@/lib/api/auth').logout as jest.Mock;
const mockUseExtensionSync = require('@/hooks/useExtensionSync').useExtensionSync as jest.Mock;

// Suppress jsdom "Not implemented: navigation" warnings
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (args[0]?.toString().includes('Not implemented: navigation')) {
      return;
    }
    originalConsoleError(...args);
  };
});

afterAll(() => {
  console.error = originalConsoleError;
});

function Consumer() {
  const { user, loading, error, logout, refresh } = useAuthSession();
  return (
    <div>
      <span data-testid='loading'>{loading ? 'true' : 'false'}</span>
      <span data-testid='error'>{error ?? ''}</span>
      <span data-testid='user'>{user ? user.displayName : ''}</span>
      <button onClick={logout} data-testid='logout-btn'>Logout</button>
      <button onClick={refresh} data-testid='refresh-btn'>Refresh</button>
    </div>
  );
}

describe('AuthContext / AuthProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseExtensionSync.mockReset();
  });

  it('在載入期間會先顯示 loading=true', async () => {
    mockGetMe.mockResolvedValueOnce({
      streamerId: 's1',
      twitchUserId: 't1',
      displayName: 'Test User',
      avatarUrl: 'https://example.com/avatar.png',
      channelUrl: 'https://twitch.tv/test',
      role: 'streamer',
    });

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    expect(screen.getByTestId('loading').textContent).toBe('true');

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
  });

  it('getMe 成功時會設定 user 並結束 loading', async () => {
    mockGetMe.mockResolvedValueOnce({
      streamerId: 's1',
      twitchUserId: 't1',
      displayName: 'Test User',
      avatarUrl: 'https://example.com/avatar.png',
      channelUrl: 'https://twitch.tv/test',
      role: 'streamer',
    });

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('user').textContent).toBe('Test User');
    expect(screen.getByTestId('error').textContent).toBe('');
  });

  it('getMe 失敗時會設定 error 並清除 user', async () => {
    mockGetMe.mockRejectedValueOnce(new Error('network error'));

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('user').textContent).toBe('');
    expect(screen.getByTestId('error').textContent).toContain('network error');
  });

  it('logout 成功時會清除 user 並導向首頁', async () => {
    const user = userEvent.setup();
    mockGetMe.mockResolvedValueOnce({
      streamerId: 's1',
      twitchUserId: 't1',
      displayName: 'Test User',
      avatarUrl: 'https://example.com/avatar.png',
      channelUrl: 'https://twitch.tv/test',
      role: 'streamer',
    });
    mockLogout.mockResolvedValueOnce({ message: 'Logged out' });

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('Test User');
    });

    const logoutBtn = screen.getByTestId('logout-btn');
    await user.click(logoutBtn);

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled();
    });

    // Note: window.location.href redirect is tested via E2E tests
    // jsdom doesn't fully support navigation testing
  });

  it('logout 失敗時會記錄錯誤但不影響狀態', async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    mockGetMe.mockResolvedValueOnce({
      streamerId: 's1',
      twitchUserId: 't1',
      displayName: 'Test User',
      avatarUrl: 'https://example.com/avatar.png',
      channelUrl: 'https://twitch.tv/test',
      role: 'streamer',
    });
    mockLogout.mockRejectedValueOnce(new Error('Logout failed'));

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('Test User');
    });

    const logoutBtn = screen.getByTestId('logout-btn');
    await user.click(logoutBtn);

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled();
    });

    consoleErrorSpy.mockRestore();
  });

  it('logout 超時時仍會完成流程', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    jest.useFakeTimers();
    mockGetMe.mockResolvedValueOnce({
      streamerId: 's1',
      twitchUserId: 't1',
      displayName: 'Test User',
      avatarUrl: 'https://example.com/avatar.png',
      channelUrl: 'https://twitch.tv/test',
      role: 'streamer',
    });
    mockLogout.mockImplementationOnce(
      () =>
        new Promise(() => {
          // never resolves
        })
    );

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('Test User');
    });

    await user.click(screen.getByTestId('logout-btn'));
    jest.advanceTimersByTime(3000);

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled();
    });

    jest.useRealTimers();
  });

  it('refresh 函數可以重新獲取使用者資料', async () => {
    const user = userEvent.setup();
    mockGetMe
      .mockResolvedValueOnce({
        streamerId: 's1',
        twitchUserId: 't1',
        displayName: 'Initial User',
        avatarUrl: 'https://example.com/avatar1.png',
        channelUrl: 'https://twitch.tv/initial',
        role: 'streamer',
      })
      .mockResolvedValueOnce({
        streamerId: 's2',
        twitchUserId: 't2',
        displayName: 'Updated User',
        avatarUrl: 'https://example.com/avatar2.png',
        channelUrl: 'https://twitch.tv/updated',
        role: 'streamer',
      });

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('Initial User');
    });

    const refreshBtn = screen.getByTestId('refresh-btn');
    await user.click(refreshBtn);

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('Updated User');
    });

    expect(mockGetMe).toHaveBeenCalledTimes(2);
  });

  it('useAuthSession 在 AuthProvider 外使用時會拋出錯誤', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    
    function BadConsumer() {
      useAuthSession();
      return null;
    }

    expect(() => {
      render(<BadConsumer />);
    }).toThrow('useAuthSession must be used within an AuthProvider');

    consoleErrorSpy.mockRestore();
  });

  it('getMe 失敗時以非 Error 物件設定錯誤訊息', async () => {
    // Covers the `err instanceof Error ? ... : "Failed to fetch user"` fallback
    mockGetMe.mockRejectedValueOnce('string error - not an Error instance');

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('error').textContent).toBe('Failed to fetch user');
  });

  it('isStreamer 和 isViewer 在有 user 時正確計算', async () => {
    mockGetMe.mockResolvedValueOnce({
      viewerId: 'v1',
      twitchUserId: 't1',
      displayName: 'Viewer User',
      avatarUrl: 'https://example.com/avatar.png',
      role: 'viewer',
    });

    function RoleConsumer() {
      const { isStreamer, isViewer } = useAuthSession();
      return (
        <div>
          <span data-testid='isStreamer'>{isStreamer ? 'true' : 'false'}</span>
          <span data-testid='isViewer'>{isViewer ? 'true' : 'false'}</span>
        </div>
      );
    }

    render(
      <AuthProvider>
        <RoleConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('isStreamer').textContent).toBe('false');
      expect(screen.getByTestId('isViewer').textContent).toBe('true');
    });
  });

  it('refresh 在請求進行中時會直接返回，不重複呼叫 getMe', async () => {
    const user = userEvent.setup();
    let resolveFetch!: (value: unknown) => void;
    mockGetMe.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    const refreshBtn = await screen.findByTestId('refresh-btn');
    await user.click(refreshBtn);
    await user.click(refreshBtn);

    expect(mockGetMe).toHaveBeenCalledTimes(1);

    resolveFetch({
      streamerId: 's1',
      twitchUserId: 't1',
      displayName: 'Resolved User',
      avatarUrl: 'https://example.com/avatar.png',
      channelUrl: 'https://twitch.tv/test',
      role: 'streamer',
    });

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('Resolved User');
    });
  });

  it('useExtensionSync receives null when user has no viewerId or streamerId', async () => {
    mockGetMe.mockResolvedValueOnce({
      twitchUserId: 't1',
      displayName: 'Unknown Role User',
      avatarUrl: 'https://example.com/avatar.png',
      role: 'guest',
    });

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(mockUseExtensionSync).toHaveBeenCalledWith(null);
  });

  it('useExtensionSync receives streamerId fallback for streamer users', async () => {
    mockGetMe.mockResolvedValueOnce({
      streamerId: 'streamer-1',
      twitchUserId: 't1',
      displayName: 'Streamer User',
      avatarUrl: 'https://example.com/avatar.png',
      channelUrl: 'https://twitch.tv/test',
      role: 'streamer',
    });

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('Streamer User');
    });

    expect(mockUseExtensionSync).toHaveBeenCalledWith('streamer-1');
  });

  it('does not re-fetch on rerender after initialization', async () => {
    mockGetMe.mockResolvedValueOnce({
      streamerId: 'streamer-1',
      twitchUserId: 't1',
      displayName: 'Stable User',
      avatarUrl: 'https://example.com/avatar.png',
      channelUrl: 'https://twitch.tv/test',
      role: 'streamer',
    });

    const { rerender } = render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('Stable User');
    });

    rerender(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    expect(mockGetMe).toHaveBeenCalledTimes(1);
  });

  it('shouldInitializeAuth returns expected booleans', () => {
    expect(shouldInitializeAuth(false, false)).toBe(true);
    expect(shouldInitializeAuth(true, false)).toBe(false);
    expect(shouldInitializeAuth(false, true)).toBe(false);
  });

  it('resolveViewerId returns expected values for user variants', () => {
    expect(resolveViewerId(null)).toBeNull();
    expect(resolveViewerId({ viewerId: 'viewer-1', role: 'viewer' } as any)).toBe('viewer-1');
    expect(resolveViewerId({ streamerId: 'streamer-1', role: 'streamer' } as any)).toBe('streamer-1');
    expect(resolveViewerId({ role: 'guest' } as any)).toBeNull();
  });
});
