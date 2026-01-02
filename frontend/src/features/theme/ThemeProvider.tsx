"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = "twitch-analytics-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("dark");
  const [mounted, setMounted] = useState(false);

  // 初始化主題
  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (savedTheme && ["light", "dark", "system"].includes(savedTheme)) {
      setThemeState(savedTheme);
    }
  }, []);

  // 監聽系統主題變化
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = () => {
      if (theme === "system") {
        const systemTheme = mediaQuery.matches ? "dark" : "light";
        setResolvedTheme(systemTheme);
        updateDOM(systemTheme);
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  // 當主題變化時更新 DOM
  useEffect(() => {
    if (!mounted) return;

    let newResolvedTheme: "light" | "dark";

    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      newResolvedTheme = mediaQuery.matches ? "dark" : "light";
    } else {
      newResolvedTheme = theme;
    }

    setResolvedTheme(newResolvedTheme);
    updateDOM(newResolvedTheme);
  }, [theme, mounted]);

  const updateDOM = (resolvedTheme: "light" | "dark") => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);

    // 更新 meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute(
        "content",
        resolvedTheme === "dark" ? "#0e0e10" : "#ffffff"
      );
    }
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
  };

  // 避免 SSR hydration 問題
  if (!mounted) {
    return <div style={{ visibility: "hidden" }}>{children}</div>;
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
