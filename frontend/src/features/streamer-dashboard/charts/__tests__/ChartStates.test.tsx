import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChartLoading, ChartError, ChartEmpty, ChartDataLimitedBanner, ChartEstimatedBadge } from '../ChartStates';

describe('ChartStates', () => {
  describe('ChartLoading', () => {
    it('應該顯示自訂載入訊息', () => {
      render(<ChartLoading message='載入圖表資料...' />);
      expect(screen.getByText('載入圖表資料...')).toBeInTheDocument();
    });

    it('應該顯示預設載入訊息', () => {
      render(<ChartLoading />);
      expect(screen.getByText('loading')).toBeInTheDocument();
    });

    it('應該顯示旋轉載入動畫', () => {
      const { container } = render(<ChartLoading />);
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
      expect(spinner).toHaveClass('border-purple-500');
    });
  });

  describe('ChartError', () => {
    it('應該顯示錯誤訊息', () => {
      render(<ChartError error='API 連線失敗' />);
      expect(screen.getByText('errorTitle')).toBeInTheDocument();
      expect(screen.getByText('API 連線失敗')).toBeInTheDocument();
    });

    it('應該顯示警告圖示', () => {
      const { container } = render(<ChartError error='測試錯誤' />);
      const emojiDiv = container.querySelector('.text-5xl');
      expect(emojiDiv).toHaveTextContent('⚠️');
    });

    it('有 onRetry 時應該顯示重試按鈕', () => {
      const onRetry = jest.fn();
      render(<ChartError error='測試錯誤' onRetry={onRetry} />);
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    it('沒有 onRetry 時不應該顯示重試按鈕', () => {
      render(<ChartError error='測試錯誤' />);
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('點擊重試按鈕時應該呼叫 onRetry', async () => {
      const onRetry = jest.fn();
      const user = userEvent.setup();
      
      render(<ChartError error='測試錯誤' onRetry={onRetry} />);
      const retryButton = screen.getByRole('button', { name: /retry/i });
      
      await user.click(retryButton);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('ChartEmpty', () => {
    it('應該顯示所有提供的內容', () => {
      const { container } = render(
        <ChartEmpty 
          emoji='🎯'
          title='自訂標題'
          description='目前沒有資料'
          hint='請選擇不同的時間範圍'
        />
      );
      
      const emojiDiv = container.querySelector('.text-5xl');
      expect(emojiDiv).toHaveTextContent('🎯');
      expect(screen.getByText('自訂標題')).toBeInTheDocument();
      expect(screen.getByText('目前沒有資料')).toBeInTheDocument();
      expect(screen.getByText('請選擇不同的時間範圍')).toBeInTheDocument();
    });

    it('應該使用預設 emoji 和 title', () => {
      const { container } = render(<ChartEmpty description='無資料' />);
      const emojiDiv = container.querySelector('.text-5xl');
      expect(emojiDiv).toHaveTextContent('📊');
      expect(screen.getByText('emptyTitle')).toBeInTheDocument();
    });

    it('沒有 hint 時不應該顯示提示文字', () => {
      render(<ChartEmpty description='無資料' />);
      expect(screen.queryByText(/請選擇/)).not.toBeInTheDocument();
    });

    it('應該正確顯示不同的 emoji', () => {
      const { container } = render(<ChartEmpty emoji='🔍' description='無資料' />);
      const emojiDiv = container.querySelector('.text-5xl');
      expect(emojiDiv).toHaveTextContent('🔍');
    });

    it('有 actionButton 且非 loading 時應該顯示按鈕標籤', () => {
      const onClick = jest.fn();
      render(
        <ChartEmpty
          description='無資料'
          actionButton={{ label: '立即同步', onClick, isLoading: false }}
        />
      );
      expect(screen.getByRole('button', { name: '立即同步' })).toBeInTheDocument();
    });

    it('有 actionButton 且 isLoading=true 時應該顯示 syncing 文字且按鈕 disabled', () => {
      const onClick = jest.fn();
      render(
        <ChartEmpty
          description='無資料'
          actionButton={{ label: '立即同步', onClick, isLoading: true }}
        />
      );
      const btn = screen.getByRole('button');
      expect(btn).toBeDisabled();
      expect(screen.getByText('syncing')).toBeInTheDocument();
    });

    it('點擊 actionButton 時應該呼叫 onClick', async () => {
      const onClick = jest.fn();
      const user = userEvent.setup();
      render(
        <ChartEmpty
          description='無資料'
          actionButton={{ label: '立即同步', onClick }}
        />
      );
      await user.click(screen.getByRole('button', { name: '立即同步' }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('ChartDataLimitedBanner', () => {
    it('應該顯示 limited data 訊息', () => {
      render(<ChartDataLimitedBanner currentDays={3} minDays={7} />);
      expect(screen.getByText('comingSoon')).toBeInTheDocument();
      // limitedData translation key rendered by mock
      expect(screen.getByText(/limitedData/i)).toBeInTheDocument();
    });

    it('沒有 onSync 時不應該顯示同步按鈕', () => {
      render(<ChartDataLimitedBanner currentDays={3} minDays={7} />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('有 onSync 且非 syncing 時應該顯示 syncNow', () => {
      const onSync = jest.fn();
      render(<ChartDataLimitedBanner currentDays={3} minDays={7} onSync={onSync} />);
      expect(screen.getByText('syncNow')).toBeInTheDocument();
      expect(screen.getByRole('button')).not.toBeDisabled();
    });

    it('isSyncing=true 時應該顯示 syncing 並且按鈕 disabled', () => {
      const onSync = jest.fn();
      render(
        <ChartDataLimitedBanner currentDays={3} minDays={7} onSync={onSync} isSyncing />
      );
      const btn = screen.getByRole('button');
      expect(btn).toBeDisabled();
      expect(screen.getByText('syncing')).toBeInTheDocument();
    });

    it('點擊同步按鈕時應該呼叫 onSync', async () => {
      const onSync = jest.fn();
      const user = userEvent.setup();
      render(<ChartDataLimitedBanner currentDays={3} minDays={7} onSync={onSync} />);
      await user.click(screen.getByRole('button'));
      expect(onSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('ChartEstimatedBadge', () => {
    it('應該顯示 estimate 文字', () => {
      render(<ChartEstimatedBadge />);
      expect(screen.getByText('estimate')).toBeInTheDocument();
    });

    it('應該顯示警告 icon 且有 aria-label', () => {
      render(<ChartEstimatedBadge />);
      expect(screen.getByRole('img', { name: 'estimate' })).toBeInTheDocument();
    });
  });
});
