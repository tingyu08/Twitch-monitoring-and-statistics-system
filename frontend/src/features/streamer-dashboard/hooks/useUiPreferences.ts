/**
 * UI Preferences Hook
 *
 * 管理儀表板顯示偏好設定，使用 localStorage 持久化
 * Story 1.5: 實況主儀表板 UX 偏好設定
 */

"use client";

import { useState, useEffect, useCallback } from "react";

// localStorage key（包含版本號，方便未來升級）
const STORAGE_KEY = "bmad.streamerDashboard.uiPreferences.v1";

export function hasWindow() {
  return typeof window !== "undefined";
}

function getWindowAvailability() {
  return __uiPreferencesTestables.hasWindow();
}

/**
 * UI 偏好設定介面
 */
export interface UiPreferences {
  /** 是否顯示開台統計總覽（Summary Cards） */
  showSummaryCards: boolean;
  /** 是否顯示開台時間分析（時間序列圖） */
  showTimeSeriesChart: boolean;
  /** 是否顯示開台時段分布（熱力圖） */
  showHeatmapChart: boolean;
  /** 是否顯示訂閱數趨勢 */
  showSubscriptionChart: boolean;
}

/**
 * 預設偏好設定（新手友善配置）
 * AC3: 第一次登入時顯示所有核心指標
 */
const DEFAULT_PREFERENCES: UiPreferences = {
  showSummaryCards: true,
  showTimeSeriesChart: true,
  showHeatmapChart: true,
  showSubscriptionChart: true,
};

/**
 * 從 localStorage 讀取偏好設定
 */
function loadPreferences(): UiPreferences {
  if (!getWindowAvailability()) {
    return DEFAULT_PREFERENCES;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // 合併預設值，確保新增的設定項有預設值
      return { ...DEFAULT_PREFERENCES, ...parsed };
    }
  } catch (error) {
    console.warn("Failed to load UI preferences from localStorage:", error);
  }

  return DEFAULT_PREFERENCES;
}

/**
 * 儲存偏好設定到 localStorage
 */
function savePreferences(preferences: UiPreferences): void {
  if (!getWindowAvailability()) {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.warn("Failed to save UI preferences to localStorage:", error);
  }
}

export const __uiPreferencesTestables = {
  hasWindow,
  loadPreferences,
  savePreferences,
};

/**
 * UI 偏好設定 Hook
 *
 * @returns 偏好設定狀態和控制方法
 *
 * @example
 * ```tsx
 * const { preferences, togglePreference, resetToDefault } = useUiPreferences();
 *
 * // 切換某個設定
 * togglePreference('showSummaryCards');
 *
 * // 條件渲染
 * {preferences.showSummaryCards && <SummaryCards />}
 * ```
 */
export function useUiPreferences() {
  const [preferences, setPreferences] =
    useState<UiPreferences>(DEFAULT_PREFERENCES);
  const [isLoaded, setIsLoaded] = useState(false);

  // 初始化時從 localStorage 讀取
  useEffect(() => {
    const loaded = loadPreferences();
    setPreferences(loaded);
    setIsLoaded(true);
  }, []);

  // 當偏好改變時儲存到 localStorage
  useEffect(() => {
    if (isLoaded) {
      savePreferences(preferences);
    }
  }, [preferences, isLoaded]);

  /**
   * 切換單一偏好設定
   */
  const togglePreference = useCallback((key: keyof UiPreferences) => {
    setPreferences((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  /**
   * 設定單一偏好
   */
  const setPreference = useCallback(
    (key: keyof UiPreferences, value: boolean) => {
      setPreferences((prev) => ({
        ...prev,
        [key]: value,
      }));
    },
    []
  );

  /**
   * 重置為預設值
   */
  const resetToDefault = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
  }, []);

  /**
   * 全部顯示
   */
  const showAll = useCallback(() => {
    setPreferences({
      showSummaryCards: true,
      showTimeSeriesChart: true,
      showHeatmapChart: true,
      showSubscriptionChart: true,
    });
  }, []);

  /**
   * 全部隱藏
   */
  const hideAll = useCallback(() => {
    setPreferences({
      showSummaryCards: false,
      showTimeSeriesChart: false,
      showHeatmapChart: false,
      showSubscriptionChart: false,
    });
  }, []);

  /**
   * 計算當前顯示的區塊數量
   */
  const visibleCount = Object.values(preferences).filter(Boolean).length;

  return {
    preferences,
    isLoaded,
    togglePreference,
    setPreference,
    resetToDefault,
    showAll,
    hideAll,
    visibleCount,
  };
}

/**
 * 偏好設定項目定義（用於 UI 渲染）
 */
export const PREFERENCE_ITEMS: Array<{
  key: keyof UiPreferences;
  label: string;
  description: string;
  icon: string;
}> = [
  {
    key: "showSummaryCards",
    label: "開台統計總覽",
    description: "總開台時數、場數、平均時長",
    icon: "📊",
  },
  {
    key: "showTimeSeriesChart",
    label: "開台時間分析",
    description: "開台時數與場數趨勢圖",
    icon: "📈",
  },
  {
    key: "showHeatmapChart",
    label: "開台時段分布",
    description: "每週開台時段熱力圖",
    icon: "🗓️",
  },
  {
    key: "showSubscriptionChart",
    label: "訂閱數趨勢",
    description: "訂閱總數與淨變化趨勢",
    icon: "💜",
  },
];
