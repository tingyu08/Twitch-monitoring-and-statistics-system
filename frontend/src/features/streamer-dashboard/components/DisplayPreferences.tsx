/**
 * Display Preferences Component
 *
 * 顯示設定面板，讓用戶控制儀表板各區塊的顯示/隱藏
 * Story 1.5: 實況主儀表板 UX 偏好設定
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { useUiPreferences, PREFERENCE_ITEMS, type UiPreferences } from '../hooks/useUiPreferences';

interface DisplayPreferencesProps {
  /** 外部傳入的偏好設定（用於受控模式） */
  preferences?: UiPreferences;
  /** 切換偏好的回調 */
  onToggle?: (key: keyof UiPreferences) => void;
  /** 是否使用緊湊模式 */
  compact?: boolean;
}

/**
 * Toggle 開關組件
 */
function Toggle({
  checked,
  onChange,
  label,
  description,
  icon,
  id,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
  icon: string;
  id: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 cursor-pointer transition-colors group"
    >
      <div className="flex items-center gap-3">
        <span className="text-xl" role="img" aria-hidden="true">
          {icon}
        </span>
        <div>
          <div className="text-sm font-medium text-white group-hover:text-purple-300 transition-colors">
            {label}
          </div>
          <div className="text-xs text-gray-400">
            {description}
          </div>
        </div>
      </div>

      {/* Toggle Switch */}
      <div className="relative">
        <input
          type="checkbox"
          id={id}
          aria-label={label}
          checked={checked}
          onChange={onChange}
          className="sr-only peer"
          aria-describedby={`${id}-desc`}
        />
        <div
          className={`
            w-11 h-6 rounded-full transition-colors
            ${checked ? 'bg-purple-600' : 'bg-gray-600'}
            peer-focus:ring-2 peer-focus:ring-purple-500 peer-focus:ring-offset-2 peer-focus:ring-offset-gray-900
          `}
        />
        <div
          className={`
            absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform
            ${checked ? 'translate-x-5' : 'translate-x-0'}
          `}
        />
        <span id={`${id}-desc`} className="sr-only">
          {checked ? '已顯示' : '已隱藏'} {label}
        </span>
      </div>
    </label>
  );
}

/**
 * 顯示設定面板
 */
export function DisplayPreferences({ preferences: externalPrefs, onToggle, compact = false }: DisplayPreferencesProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const internalHook = useUiPreferences();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 點擊外部關閉下拉面板
  useEffect(() => {
    if (!isExpanded) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExpanded]);

  // 使用外部傳入的或內部的偏好設定
  const preferences = externalPrefs || internalHook.preferences;
  const togglePreference = onToggle || internalHook.togglePreference;
  const visibleCount = Object.values(preferences).filter(Boolean).length;

  if (compact) {
    // 緊湊模式：按鈕 + 下拉面板
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          aria-expanded={isExpanded}
          aria-controls="display-preferences-panel"
          data-testid="display-preferences-button"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span>顯示設定</span>
          <span className="text-xs text-gray-500">({visibleCount}/4)</span>
          <svg
            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* 下拉面板 */}
        {isExpanded && (
          <div
            id="display-preferences-panel"
            className="absolute right-0 top-full mt-2 w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50"
            data-testid="display-preferences-panel"
          >
            <div className="p-4 space-y-2">
              <div className="text-sm font-medium text-gray-300 mb-3">顯示/隱藏儀表板區塊</div>
              {PREFERENCE_ITEMS.map((item) => (
                <Toggle
                  key={item.key}
                  id={`pref-${item.key}`}
                  checked={preferences[item.key]}
                  onChange={() => togglePreference(item.key)}
                  label={item.label}
                  description={item.description}
                  icon={item.icon}
                />
              ))}

              {/* Quick Actions */}
              <div className="flex gap-2 pt-3 border-t border-gray-700/50 mt-3">
                <button
                  onClick={() => {
                    PREFERENCE_ITEMS.forEach(item => {
                      if (!preferences[item.key]) {
                        togglePreference(item.key);
                      }
                    });
                  }}
                  className="flex-1 px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700/50 hover:bg-gray-600/50 rounded transition-colors"
                  data-testid="show-all-button"
                >
                  全部顯示
                </button>
                <button
                  onClick={() => {
                    PREFERENCE_ITEMS.forEach(item => {
                      if (preferences[item.key]) {
                        togglePreference(item.key);
                      }
                    });
                  }}
                  className="flex-1 px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700/50 hover:bg-gray-600/50 rounded transition-colors"
                  data-testid="hide-all-button"
                >
                  全部隱藏
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-gray-800/30 rounded-xl border border-gray-700/50">
      {/* Header - 可點擊展開/收合 */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-700/30 rounded-t-xl transition-colors"
        aria-expanded={isExpanded}
        aria-controls="display-preferences-panel"
      >
        <div className="flex items-center gap-3">
          <svg
            className="w-5 h-5 text-purple-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <div>
            <h3 className="text-sm font-medium text-white">顯示設定</h3>
            <p className="text-xs text-gray-400">自訂儀表板顯示的區塊</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 bg-gray-700/50 px-2 py-1 rounded">
            {visibleCount}/4 區塊
          </span>
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded Panel */}
      {isExpanded && (
        <div
          id="display-preferences-panel"
          className="p-4 pt-0 space-y-2 border-t border-gray-700/50"
        >
          {PREFERENCE_ITEMS.map((item) => (
            <Toggle
              key={item.key}
              id={`pref-${item.key}`}
              checked={preferences[item.key]}
              onChange={() => togglePreference(item.key)}
              label={item.label}
              description={item.description}
              icon={item.icon}
            />
          ))}

          {/* Quick Actions */}
          <div className="flex gap-2 pt-2 border-t border-gray-700/30">
            <button
              onClick={() => {
                PREFERENCE_ITEMS.forEach(item => {
                  if (!preferences[item.key]) {
                    togglePreference(item.key);
                  }
                });
              }}
              className="flex-1 px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700/50 hover:bg-gray-600/50 rounded transition-colors"
            >
              全部顯示
            </button>
            <button
              onClick={() => {
                PREFERENCE_ITEMS.forEach(item => {
                  if (preferences[item.key]) {
                    togglePreference(item.key);
                  }
                });
              }}
              className="flex-1 px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700/50 hover:bg-gray-600/50 rounded transition-colors"
            >
              全部隱藏
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DisplayPreferences;
