"use client";

import { useTheme } from "./ThemeProvider";
import { Sun, Moon, Monitor } from "lucide-react";

interface ThemeToggleProps {
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
}

export function ThemeToggle({
  showLabel = false,
  size = "md",
}: ThemeToggleProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const sizeClasses = {
    sm: "p-1.5",
    md: "p-2",
    lg: "p-3",
  };

  const iconSizes = {
    sm: 16,
    md: 20,
    lg: 24,
  };

  const themes = [
    { value: "light" as const, icon: Sun, label: "淺色" },
    { value: "dark" as const, icon: Moon, label: "深色" },
    { value: "system" as const, icon: Monitor, label: "系統" },
  ];

  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-gray-100 dark:bg-dark-card border border-gray-200 dark:border-dark-border">
      {themes.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className={`
            ${sizeClasses[size]}
            rounded-md transition-all duration-200
            ${
              theme === value
                ? "bg-white dark:bg-dark-hover shadow-sm text-primary-600 dark:text-primary-400"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }
          `}
          title={label}
          aria-label={`切換至${label}模式`}
        >
          <Icon size={iconSizes[size]} />
          {showLabel && <span className="ml-1 text-sm">{label}</span>}
        </button>
      ))}
    </div>
  );
}

// 簡化版：只有單一按鈕切換
export function ThemeToggleSimple({
  size = "md",
}: {
  size?: "sm" | "md" | "lg";
}) {
  const { resolvedTheme, setTheme } = useTheme();

  const iconSizes = {
    sm: 16,
    md: 20,
    lg: 24,
  };

  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg bg-gray-100 dark:bg-dark-card border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-dark-hover transition-colors"
      aria-label={`切換至${resolvedTheme === "dark" ? "淺色" : "深色"}模式`}
    >
      {resolvedTheme === "dark" ? (
        <Sun size={iconSizes[size]} />
      ) : (
        <Moon size={iconSizes[size]} />
      )}
    </button>
  );
}
