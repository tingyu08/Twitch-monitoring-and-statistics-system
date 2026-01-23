"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuthSession } from "@/features/auth/AuthContext";
import { ThemeToggle, ThemeToggleSimple } from "@/features/theme";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import { Menu, X, User, Settings, LogOut, LayoutDashboard } from "lucide-react";

interface DashboardHeaderProps {
  variant?: "viewer" | "streamer";
}

export function DashboardHeader({ variant = "viewer" }: DashboardHeaderProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuthSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // 獲取當前語言
  // (簡單從 pathname 解析，因為 next-navigation 的 useRouter 不支援自動補全 locale)
  const currentLocale = pathname?.split("/")[1] || "zh-TW";

  const isViewer = variant === "viewer" || pathname?.includes("/viewer");
  const isStreamer = variant === "streamer" || pathname?.includes("/streamer");

  const handleLogout = async () => {
    setMobileMenuOpen(false);
    await logout();
  };

  return (
    <header className="border-b border-purple-300 dark:border-white/10 backdrop-blur-md bg-white/70 dark:bg-black/20 sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex justify-between items-center">
          {/* Logo / Dashboard Label */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-purple-900 dark:text-purple-400/70 font-mono tracking-wider hidden sm:block font-bold">
              {isStreamer ? "STREAMER DASHBOARD" : "VIEWER DASHBOARD"}
            </span>
            <span className="text-xs text-purple-900 dark:text-purple-400/70 font-mono tracking-wider sm:hidden font-bold">
              {isStreamer ? t("viewer.roleStreamer") : t("viewer.roleViewer")}
            </span>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-4">
            {/* Role Switcher */}
            <div className="flex bg-purple-100/50 dark:bg-dark-hover rounded-lg p-1 border border-purple-300 dark:border-dark-border">
              <button
                type="button"
                onClick={() => !isViewer && router.push(`/${currentLocale}/dashboard/viewer`)}
                onMouseEnter={() => router.prefetch(`/${currentLocale}/dashboard/viewer`)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-[color,background-color,border-color,box-shadow,transform,opacity] ${isViewer
                    ? "bg-purple-600 text-white shadow-sm cursor-default"
                    : "text-purple-800 dark:text-purple-300 hover:text-purple-900 hover:bg-white/20 dark:hover:text-white dark:hover:bg-white/10"
                  }`}
              >
                {t("viewer.roleViewer")}
              </button>
              <button
                type="button"
                onClick={() => !isStreamer && router.push(`/${currentLocale}/dashboard/streamer`)}
                onMouseEnter={() => router.prefetch(`/${currentLocale}/dashboard/streamer`)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-[color,background-color,border-color,box-shadow,transform,opacity] ${isStreamer
                    ? "bg-purple-600 text-white shadow-sm cursor-default"
                    : "text-purple-800 dark:text-purple-300 hover:text-purple-900 hover:bg-white/20 dark:hover:text-white dark:hover:bg-white/10"
                  }`}
              >
                {t("viewer.roleStreamer")}
              </button>
            </div>

            {/* Language Switcher */}
            <LocaleSwitcher />

            {/* Theme Toggle */}
            <ThemeToggle size="sm" />
          </div>

          {/* Mobile Menu Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg bg-purple-100/50 dark:bg-dark-hover text-purple-900 dark:text-purple-300 hover:bg-purple-200 dark:hover:text-white transition-colors"
            aria-label="開啟選單"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden mt-4 pb-4 border-t border-purple-300 dark:border-dark-border pt-4 animate-in slide-in-from-top-2 duration-200">
            <div className="space-y-3">
              {/* Role Switcher - Mobile */}
              <div className="flex flex-col gap-2">
                <p className="text-xs text-purple-900/50 dark:text-purple-300/50 uppercase tracking-wider mb-1">
                  {t("nav.switchRole")}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    router.push(`/${currentLocale}/dashboard/viewer`);
                    setMobileMenuOpen(false);
                  }}
                  onMouseEnter={() => router.prefetch(`/${currentLocale}/dashboard/viewer`)}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg text-left transition-[color,background-color,border-color,box-shadow,transform,opacity] ${isViewer
                      ? "bg-purple-600/20 dark:bg-purple-600/30 text-purple-900 dark:text-purple-300 border border-purple-500/50"
                      : "bg-purple-100/30 dark:bg-white/5 text-purple-800 dark:text-purple-300/70 hover:bg-purple-100/50 dark:hover:bg-white/10"
                    }`}
                >
                  <User size={18} />
                  <span>{t("nav.viewerDashboard")}</span>
                  {isViewer && (
                    <span className="ml-auto text-xs bg-purple-500 text-white px-2 py-0.5 rounded">
                      {t("nav.current")}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    router.push(`/${currentLocale}/dashboard/streamer`);
                    setMobileMenuOpen(false);
                  }}
                  onMouseEnter={() => router.prefetch(`/${currentLocale}/dashboard/streamer`)}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg text-left transition-[color,background-color,border-color,box-shadow,transform,opacity] ${isStreamer
                      ? "bg-purple-600/20 dark:bg-purple-600/30 text-purple-900 dark:text-purple-300 border border-purple-500/50"
                      : "bg-purple-100/30 dark:bg-white/5 text-purple-800 dark:text-purple-300/70 hover:bg-purple-100/50 dark:hover:bg-white/10"
                    }`}
                >
                  <LayoutDashboard size={18} />
                  <span>{t("nav.streamerDashboard")}</span>
                  {isStreamer && (
                    <span className="ml-auto text-xs bg-purple-500 text-white px-2 py-0.5 rounded">
                      {t("nav.current")}
                    </span>
                  )}
                </button>
              </div>

              {/* Theme & Language Switcher - Mobile */}
              <div className="pt-3 border-t border-purple-300 dark:border-white/10">
                <p className="text-xs text-purple-900/50 dark:text-purple-300/50 uppercase tracking-wider mb-2">
                  {t("nav.appearance")}
                </p>
                <div className="flex justify-center items-center gap-4">
                  <LocaleSwitcher />
                  <ThemeToggle />
                </div>
              </div>

              {/* Settings & Logout - Mobile */}
              <div className="pt-3 border-t border-purple-300 dark:border-white/10 space-y-2">
                {isViewer && (
                  <button
                    type="button"
                    onClick={() => {
                      router.push(`/${currentLocale}/dashboard/viewer/settings`);
                      setMobileMenuOpen(false);
                    }}
                    className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-left bg-purple-100/30 dark:bg-white/5 text-purple-800 dark:text-purple-300/70 hover:bg-purple-100/50 dark:hover:bg-white/10 transition-[color,background-color,border-color,box-shadow,transform,opacity]"
                  >
                    <Settings size={18} />
                    <span>{t("nav.settings")}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-left bg-red-100/30 dark:bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-100/50 dark:hover:bg-red-500/20 transition-[color,background-color,border-color,box-shadow,transform,opacity]"
                >
                  <LogOut size={18} />
                  <span>{t("common.logout")}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
