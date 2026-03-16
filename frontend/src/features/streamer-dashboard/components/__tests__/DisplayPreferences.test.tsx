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

  it('should call hideAll in non-compact mode to toggle visible items off', async () => {
    const onToggle = jest.fn();
    const user = userEvent.setup();

    render(<DisplayPreferences preferences={defaultPrefs} onToggle={onToggle} />);

    const headerButton = screen.getByRole('button', { name: /displaySettings/i });
    await user.click(headerButton);

    const hideAllBtn = screen.getByRole('button', { name: /hideAll/ });
    await user.click(hideAllBtn);

    // All 4 items are visible, so onToggle called for each
    expect(onToggle).toHaveBeenCalledTimes(4);
  });

  it('compact mode: should open dropdown when button is clicked', async () => {
    const user = userEvent.setup();

    render(<DisplayPreferences preferences={defaultPrefs} compact />);

    const triggerBtn = screen.getByTestId('display-preferences-button');
    await user.click(triggerBtn);

    expect(screen.getByTestId('display-preferences-panel')).toBeInTheDocument();
  });

  it('compact mode: should close dropdown when button is clicked again', async () => {
    const user = userEvent.setup();

    render(<DisplayPreferences preferences={defaultPrefs} compact />);

    const triggerBtn = screen.getByTestId('display-preferences-button');
    await user.click(triggerBtn);
    expect(screen.getByTestId('display-preferences-panel')).toBeInTheDocument();

    await user.click(triggerBtn);
    expect(screen.queryByTestId('display-preferences-panel')).not.toBeInTheDocument();
  });

  it('compact mode: should call onToggle when toggling a preference', async () => {
    const onToggle = jest.fn();
    const user = userEvent.setup();

    render(<DisplayPreferences preferences={defaultPrefs} onToggle={onToggle} compact />);

    const triggerBtn = screen.getByTestId('display-preferences-button');
    await user.click(triggerBtn);

    const summaryToggle = screen.getByLabelText('summaryCards');
    await user.click(summaryToggle);

    expect(onToggle).toHaveBeenCalledWith('showSummaryCards');
  });

  it('compact mode: should show all using show-all button', async () => {
    const onToggle = jest.fn();
    const user = userEvent.setup();
    const partialPrefs: UiPreferences = {
      showSummaryCards: false,
      showTimeSeriesChart: true,
      showHeatmapChart: false,
      showSubscriptionChart: true,
    };

    render(<DisplayPreferences preferences={partialPrefs} onToggle={onToggle} compact />);

    const triggerBtn = screen.getByTestId('display-preferences-button');
    await user.click(triggerBtn);

    const showAllBtn = screen.getByTestId('show-all-button');
    await user.click(showAllBtn);

    expect(onToggle).toHaveBeenCalledWith('showSummaryCards');
    expect(onToggle).toHaveBeenCalledWith('showHeatmapChart');
    expect(onToggle).not.toHaveBeenCalledWith('showTimeSeriesChart');
  });

  it('compact mode: should hide all using hide-all button', async () => {
    const onToggle = jest.fn();
    const user = userEvent.setup();

    render(<DisplayPreferences preferences={defaultPrefs} onToggle={onToggle} compact />);

    const triggerBtn = screen.getByTestId('display-preferences-button');
    await user.click(triggerBtn);

    const hideAllBtn = screen.getByTestId('hide-all-button');
    await user.click(hideAllBtn);

    expect(onToggle).toHaveBeenCalledTimes(4);
  });

  it('compact mode: hide-all only toggles currently visible items', async () => {
    const onToggle = jest.fn();
    const user = userEvent.setup();
    const partialPrefs: UiPreferences = {
      showSummaryCards: true,
      showTimeSeriesChart: false,
      showHeatmapChart: true,
      showSubscriptionChart: false,
    };

    render(<DisplayPreferences preferences={partialPrefs} onToggle={onToggle} compact />);

    await user.click(screen.getByTestId('display-preferences-button'));
    await user.click(screen.getByTestId('hide-all-button'));

    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenCalledWith('showSummaryCards');
    expect(onToggle).toHaveBeenCalledWith('showHeatmapChart');
  });

  it('non-compact hide-all skips preferences that are already hidden', async () => {
    const onToggle = jest.fn();
    const user = userEvent.setup();
    const partialPrefs: UiPreferences = {
      showSummaryCards: true,
      showTimeSeriesChart: false,
      showHeatmapChart: true,
      showSubscriptionChart: false,
    };

    render(<DisplayPreferences preferences={partialPrefs} onToggle={onToggle} />);

    await user.click(screen.getByRole('button', { name: /displaySettings/i }));
    await user.click(screen.getByRole('button', { name: /hideAll/ }));

    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('compact mode: should close dropdown when clicking outside', async () => {
    const user = userEvent.setup();

    render(
      <div>
        <div data-testid="outside">Outside</div>
        <DisplayPreferences preferences={defaultPrefs} compact />
      </div>
    );

    const triggerBtn = screen.getByTestId('display-preferences-button');
    await user.click(triggerBtn);
    expect(screen.getByTestId('display-preferences-panel')).toBeInTheDocument();

    // Click outside the dropdown
    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByTestId('display-preferences-panel')).not.toBeInTheDocument();
  });
});
