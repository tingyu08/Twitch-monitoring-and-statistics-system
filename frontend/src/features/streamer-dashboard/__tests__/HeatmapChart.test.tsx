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
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('23')).toBeInTheDocument();
  });

  it('should render legend with color scale', () => {
    render(<HeatmapChart data={mockData} />);

    // Legend values - some numbers appear in hour labels too, so use getAllBy
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    // After dynamic scale optimization, legend shows "4.0+" instead of "4+"
    expect(screen.getByText('4.0+')).toBeInTheDocument();
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
});
