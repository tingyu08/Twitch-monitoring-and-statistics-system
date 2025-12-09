import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuthSession } from '../AuthContext';

// Mock API functions
jest.mock('@/lib/api/auth', () => ({
  getMe: jest.fn(),
  logout: jest.fn(),
}));

const mockGetMe = require('@/lib/api/auth').getMe as jest.Mock;
const mockLogout = require('@/lib/api/auth').logout as jest.Mock;

// Mock window.location
delete (window as any).location;
window.location = { href: '' } as any;

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
    window.location.href = '';
  });

  it('在載入期間會先顯示 loading=true', async () => {
    mockGetMe.mockResolvedValueOnce({
      streamerId: 's1',
      twitchUserId: 't1',
      displayName: 'Test User',
      avatarUrl: 'https://example.com/avatar.png',
      channelUrl: 'https://twitch.tv/test',
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
      expect(window.location.href).toContain('/');
    });
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

  it('refresh 函數可以重新獲取使用者資料', async () => {
    const user = userEvent.setup();
    mockGetMe
      .mockResolvedValueOnce({
        streamerId: 's1',
        twitchUserId: 't1',
        displayName: 'Initial User',
        avatarUrl: 'https://example.com/avatar1.png',
        channelUrl: 'https://twitch.tv/initial',
      })
      .mockResolvedValueOnce({
        streamerId: 's2',
        twitchUserId: 't2',
        displayName: 'Updated User',
        avatarUrl: 'https://example.com/avatar2.png',
        channelUrl: 'https://twitch.tv/updated',
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
});