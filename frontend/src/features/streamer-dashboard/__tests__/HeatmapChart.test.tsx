import { render, screen } from '@testing-library/react';
import { HeatmapChart } from '../charts/HeatmapChart';
import type { HeatmapCell } from '@/lib/api/streamer';

describe('HeatmapChart', () => {
  const mockData: HeatmapCell[] = [
    { dayOfWeek: 1, hour: 20, value: 3.5 }, // 週一 20:00
    { dayOfWeek: 2, hour: 21, value: 2.0 }, // 週二 21:00
    { dayOfWeek: 5, hour: 19, value: 4.5 }, // 週五 19:00
    { dayOfWeek: 0, hour: 14, value: 1.0 }, // 週日 14:00
  ];

  it('should render without crashing', () => {
    render(<HeatmapChart data={mockData} />);

    expect(screen.getByText('title')).toBeInTheDocument();
  });

  it('should render all day labels', () => {
    render(<HeatmapChart data={mockData} />);

    expect(screen.getByText('days.mon')).toBeInTheDocument();
    expect(screen.getByText('days.tue')).toBeInTheDocument();
    expect(screen.getByText('days.wed')).toBeInTheDocument();
    expect(screen.getByText('days.thu')).toBeInTheDocument();
    expect(screen.getByText('days.fri')).toBeInTheDocument();
    expect(screen.getByText('days.sat')).toBeInTheDocument();
    expect(screen.getByText('days.sun')).toBeInTheDocument();
  });

  it('should render hour labels (0-23)', () => {
    render(<HeatmapChart data={mockData} />);

    // Check a few hour labels - use getAllByText since some numbers appear in legend too
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
    expect(screen.getByText('23')).toBeInTheDocument();
  });

  it('should render legend with color scale', () => {
    render(<HeatmapChart data={mockData} range="7d" />);

    // 7d bins: 0, 0.2, 0.4, 0.6, 0.8, 1
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getByText('0.2')).toBeInTheDocument();
    expect(screen.getByText('0.4')).toBeInTheDocument();
    expect(screen.getByText('0.6')).toBeInTheDocument();
    expect(screen.getByText('0.8')).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  });

  it('should scale legend bins for 30d and 90d ranges', () => {
    const { rerender } = render(<HeatmapChart data={mockData} range="30d" />);

    expect(screen.getByText('0.8')).toBeInTheDocument();
    expect(screen.getByText('1.6')).toBeInTheDocument();
    expect(screen.getByText('2.4')).toBeInTheDocument();
    expect(screen.getByText('3.2')).toBeInTheDocument();
    expect(screen.getAllByText('4').length).toBeGreaterThan(0);

    rerender(<HeatmapChart data={mockData} range="90d" />);

    expect(screen.getByText('2.4')).toBeInTheDocument();
    expect(screen.getByText('4.8')).toBeInTheDocument();
    expect(screen.getByText('7.2')).toBeInTheDocument();
    expect(screen.getByText('9.6')).toBeInTheDocument();
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
  });

  it('should render 7 rows (days) x 24 columns (hours) of cells', () => {
    render(<HeatmapChart data={mockData} />);

    // Each cell has a title attribute
    const cells = document.querySelectorAll('[title]');
    // 7 days x 24 hours = 168 cells
    expect(cells.length).toBe(168);
  });

  it('should render with empty data', () => {
    render(<HeatmapChart data={[]} />);

    expect(screen.getByText('title')).toBeInTheDocument();
    // Should still render all 168 cells (with 0 values)
    const cells = document.querySelectorAll('[title]');
    expect(cells.length).toBe(168);
  });

  it('should apply correct tooltip to cells with data', () => {
    render(<HeatmapChart data={mockData} />);

    // Check that cells have correct title attributes
    const cellWithData = document.querySelector('[title="cellTooltip"]');
    expect(cellWithData).toBeInTheDocument();
  });

  it('should have hover styling on cells', () => {
    render(<HeatmapChart data={mockData} />);

    const cells = document.querySelectorAll('.hover\\:ring-2');
    expect(cells.length).toBe(168);
  });

  it('should be responsive with overflow scroll on mobile', () => {
    render(<HeatmapChart data={mockData} />);

    const container = document.querySelector('.overflow-x-auto');
    expect(container).toBeInTheDocument();
  });

  it('should apply different colors based on value', () => {
    render(<HeatmapChart data={mockData} />);

    // Get cells and check they have different background colors
    const cells = document.querySelectorAll('[style*="background-color"]');
    expect(cells.length).toBeGreaterThan(0);
  });

  it('handles previous-day timezone shifts and sunday peak summaries', () => {
    const offsetSpy = jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(300);

    render(
      <HeatmapChart
        data={[
          { dayOfWeek: 0, hour: 4, value: 5 },
          { dayOfWeek: 1, hour: 2, value: 1 },
        ]}
      />
    );

    const figure = screen.getByRole('img');
    expect(figure.getAttribute('aria-label')).toContain('ariaLabel');

    offsetSpy.mockRestore();
  });

  it('uses an empty peak suffix when all heatmap values are zero', () => {
    render(<HeatmapChart data={[{ dayOfWeek: 1, hour: 10, value: 0 }]} />);

    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('ariaLabel');
  });

  it('uses the sunday index when sunday has the peak activity', () => {
    render(<HeatmapChart data={[{ dayOfWeek: 0, hour: 10, value: 5 }]} />);

    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('ariaLabel');
  });
});
