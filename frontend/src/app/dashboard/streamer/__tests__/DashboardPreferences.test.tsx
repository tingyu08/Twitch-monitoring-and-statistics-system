import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/lib/api/auth', () => ({
  getMe: jest.fn().mockResolvedValue({
    displayName: 'Test Streamer',
    avatarUrl: '',
    twitchUserId: '123',
    streamerId: 'abc',
    channelUrl: 'https://twitch.tv/test',
  }),
}));

jest.mock('@/features/auth/AuthContext', () => ({
  useAuthSession: () => ({ logout: jest.fn() }),
}));

jest.mock('@/features/streamer-dashboard/hooks/useChartData', () => ({
  useTimeSeriesData: () => ({ data: [], isLoading: false, error: null, refresh: jest.fn() }),
  useHeatmapData: () => ({ data: [], isLoading: false, error: null, refresh: jest.fn(), maxValue: 0 }),
  useSubscriptionTrendData: () => ({
    data: [],
    isLoading: false,
    error: null,
    refresh: jest.fn(),
    currentDataDays: 0,
    minDataDays: 7,
    isEstimated: false,
  }),
}));

jest.mock('@/features/streamer-dashboard/charts', () => ({
  TimeSeriesChart: () => <div data-testid="mock-timeseries" />,
  HeatmapChart: () => <div data-testid="mock-heatmap" />,
  SubscriptionTrendChart: () => <div data-testid="mock-subscription" />,
  ChartLoading: () => <div>loading</div>,
  ChartError: () => <div>error</div>,
  ChartEmpty: () => <div>empty</div>,
  ChartDataLimitedBanner: () => <div>limited</div>,
  ChartEstimatedBadge: () => <div>estimated</div>,
}));

const mockUseUiPreferences = jest.fn();
jest.mock('@/features/streamer-dashboard/hooks/useUiPreferences', () => ({
  useUiPreferences: () => mockUseUiPreferences(),
}));

jest.mock('@/lib/logger', () => ({
  authLogger: { error: jest.fn() },
}));

import StreamerDashboard from '../page';

describe('StreamerDashboard - preferences gating', () => {
  beforeEach(() => {
    mockUseUiPreferences.mockReturnValue({
      preferences: {
        showSummaryCards: false,
        showTimeSeriesChart: false,
        showHeatmapChart: false,
        showSubscriptionChart: false,
      },
      togglePreference: jest.fn(),
      isLoaded: true,
      showAll: jest.fn(),
      resetToDefault: jest.fn(),
      visibleCount: 0,
    });
  });

  it('should hide all dashboard sections when preferences are all false', async () => {
    render(<StreamerDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-header')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('summary-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeseries-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('heatmap-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('subscription-section')).not.toBeInTheDocument();
    expect(screen.getByText(/所有圖表都被隱藏/)).toBeInTheDocument();
  });
});
