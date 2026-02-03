import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisplayPreferences } from '../DisplayPreferences';
import type { UiPreferences } from '../../hooks/useUiPreferences';

const defaultPrefs: UiPreferences = {
  showSummaryCards: true,
  showTimeSeriesChart: true,
  showHeatmapChart: true,
  showSubscriptionChart: true,
};

describe('DisplayPreferences', () => {
  it('should render preference toggles and trigger onToggle', async () => {
    const onToggle = jest.fn();
    const user = userEvent.setup();

    render(<DisplayPreferences preferences={defaultPrefs} onToggle={onToggle} />);

    const headerButton = screen.getByRole('button', { name: /displaySettings/i });
    await user.click(headerButton);

    const summaryToggle = screen.getByLabelText('summaryCards');
    await user.click(summaryToggle);

    expect(onToggle).toHaveBeenCalledWith('showSummaryCards');
    expect(screen.getByText('count')).toBeInTheDocument();
  });

  it('should show compact trigger with current visible count', () => {
    render(<DisplayPreferences preferences={defaultPrefs} compact />);
    expect(screen.getByText(/\(4\/4\)/)).toBeInTheDocument();
  });

  it('should call quick action buttons for missing items', async () => {
    const onToggle = jest.fn();
    const user = userEvent.setup();
    const partialPrefs: UiPreferences = {
      showSummaryCards: false,
      showTimeSeriesChart: true,
      showHeatmapChart: false,
      showSubscriptionChart: true,
    };

    render(<DisplayPreferences preferences={partialPrefs} onToggle={onToggle} />);

    const headerButton = screen.getByRole('button', { name: /displaySettings/i });
    await user.click(headerButton);

    const showAllBtn = screen.getByRole('button', { name: /showAll/ });
    await user.click(showAllBtn);

    expect(onToggle).toHaveBeenCalledWith('showSummaryCards');
    expect(onToggle).toHaveBeenCalledWith('showHeatmapChart');
  });
});
