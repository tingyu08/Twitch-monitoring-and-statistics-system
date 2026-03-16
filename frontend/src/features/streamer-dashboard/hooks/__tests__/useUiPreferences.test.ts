import { renderHook, act, waitFor } from '@testing-library/react';
import { __uiPreferencesTestables, useUiPreferences } from '../useUiPreferences';

const STORAGE_KEY = 'bmad.streamerDashboard.uiPreferences.v1';

describe('useUiPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('should load default preferences when storage is empty', async () => {
    const { result } = renderHook(() => useUiPreferences());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.preferences).toEqual({
      showSummaryCards: true,
      showTimeSeriesChart: true,
      showHeatmapChart: true,
      showSubscriptionChart: true,
    });
    expect(result.current.visibleCount).toBe(4);
  });

  it('should merge stored preferences and keep defaults for missing fields', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showSummaryCards: false, showHeatmapChart: false })
    );

    const { result } = renderHook(() => useUiPreferences());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.preferences).toEqual({
      showSummaryCards: false,
      showTimeSeriesChart: true,
      showHeatmapChart: false,
      showSubscriptionChart: true,
    });
    expect(result.current.visibleCount).toBe(2);
  });

  it('should persist changes when toggling preferences', async () => {
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useUiPreferences());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => {
      result.current.togglePreference('showSummaryCards');
    });

    await waitFor(() => expect(setItemSpy).toHaveBeenCalled());

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored.showSummaryCards).toBe(false);
  });

  it('should reset to defaults and update storage', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showSummaryCards: false, showSubscriptionChart: false })
    );

    const { result } = renderHook(() => useUiPreferences());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => {
      result.current.resetToDefault();
    });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      expect(stored).toEqual({
        showSummaryCards: true,
        showTimeSeriesChart: true,
        showHeatmapChart: true,
        showSubscriptionChart: true,
      });
    });
  });

  it('setPreference should set a specific key to a given value', async () => {
    const { result } = renderHook(() => useUiPreferences());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => {
      result.current.setPreference('showSummaryCards', false);
    });

    await waitFor(() => {
      expect(result.current.preferences.showSummaryCards).toBe(false);
    });

    act(() => {
      result.current.setPreference('showSummaryCards', true);
    });

    await waitFor(() => {
      expect(result.current.preferences.showSummaryCards).toBe(true);
    });
  });

  it('showAll should set all preferences to true', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        showSummaryCards: false,
        showTimeSeriesChart: false,
        showHeatmapChart: false,
        showSubscriptionChart: false,
      })
    );

    const { result } = renderHook(() => useUiPreferences());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.visibleCount).toBe(0);

    act(() => {
      result.current.showAll();
    });

    await waitFor(() => {
      expect(result.current.preferences).toEqual({
        showSummaryCards: true,
        showTimeSeriesChart: true,
        showHeatmapChart: true,
        showSubscriptionChart: true,
      });
    });

    expect(result.current.visibleCount).toBe(4);
  });

  it('hideAll should set all preferences to false', async () => {
    const { result } = renderHook(() => useUiPreferences());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.visibleCount).toBe(4);

    act(() => {
      result.current.hideAll();
    });

    await waitFor(() => {
      expect(result.current.preferences).toEqual({
        showSummaryCards: false,
        showTimeSeriesChart: false,
        showHeatmapChart: false,
        showSubscriptionChart: false,
      });
    });

    expect(result.current.visibleCount).toBe(0);
  });

  it('should handle localStorage parse error gracefully', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, 'invalid-json{{{');

    const { result } = renderHook(() => useUiPreferences());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    // Falls back to defaults
    expect(result.current.preferences).toEqual({
      showSummaryCards: true,
      showTimeSeriesChart: true,
      showHeatmapChart: true,
      showSubscriptionChart: true,
    });

    warnSpy.mockRestore();
  });

  it('savePreferences logs warning when localStorage.setItem throws', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    __uiPreferencesTestables.savePreferences({
      showSummaryCards: true,
      showTimeSeriesChart: true,
      showHeatmapChart: true,
      showSubscriptionChart: true,
    });

    expect(warnSpy).toHaveBeenCalled();
    setItemSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('loadPreferences returns defaults when hasWindow is false', () => {
    const hasWindowSpy = jest
      .spyOn(__uiPreferencesTestables, 'hasWindow')
      .mockReturnValue(false);

    expect(__uiPreferencesTestables.loadPreferences()).toEqual({
      showSummaryCards: true,
      showTimeSeriesChart: true,
      showHeatmapChart: true,
      showSubscriptionChart: true,
    });

    hasWindowSpy.mockRestore();
  });

  it('savePreferences returns early when hasWindow is false', () => {
    const hasWindowSpy = jest
      .spyOn(__uiPreferencesTestables, 'hasWindow')
      .mockReturnValue(false);
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');

    __uiPreferencesTestables.savePreferences({
      showSummaryCards: true,
      showTimeSeriesChart: true,
      showHeatmapChart: true,
      showSubscriptionChart: true,
    });

    expect(setItemSpy).not.toHaveBeenCalled();
    hasWindowSpy.mockRestore();
  });

});
