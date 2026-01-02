"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthSession } from "@/features/auth/AuthContext";
import { ThemeToggle, ThemeToggleSimple } from "@/features/theme";
import { Menu, X, User, Settings, LogOut, LayoutDashboard } from "lucide-react";

interface DashboardHeaderProps {
  variant?: "viewer" | "streamer";
}

export function DashboardHeader({ variant = "viewer" }: DashboardHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuthSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isViewer = variant === "viewer" || pathname?.includes("/viewer");
  const isStreamer = variant === "streamer" || pathname?.includes("/streamer");

  const handleLogout = async () => {
    setMobileMenuOpen(false);
    await logout();
  };

  return (
    <header className="border-b border-white/10 dark:border-dark-border backdrop-blur-sm bg-black/20 dark:bg-dark-card/80 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex justify-between items-center">
          {/* Logo / Dashboard Label */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-purple-300/70 dark:text-purple-400/70 font-mono tracking-wider hidden sm:block">
              {isStreamer ? "STREAMER DASHBOARD" : "VIEWER DASHBOARD"}
            </span>
            <span className="text-xs text-purple-300/70 dark:text-purple-400/70 font-mono tracking-wider sm:hidden">
              {isStreamer ? "實況主" : "觀眾"}
            </span>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-4">
            {/* Role Switcher */}
            <div className="flex bg-white/10 dark:bg-dark-hover rounded-lg p-1 border border-white/10 dark:border-dark-border">
              <button
                type="button"
                onClick={() => !isViewer && router.push("/dashboard/viewer")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  isViewer
                    ? "bg-purple-600 text-white shadow-sm cursor-default"
                    : "text-purple-300 hover:text-white hover:bg-white/10"
                }`}
              >
                觀眾
              </button>
              <button
                type="button"
                onClick={() =>
                  !isStreamer && router.push("/dashboard/streamer")
                }
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  isStreamer
                    ? "bg-purple-600 text-white shadow-sm cursor-default"
                    : "text-purple-300 hover:text-white hover:bg-white/10"
                }`}
              >
                實況主
              </button>
            </div>

            {/* Theme Toggle */}
            <ThemeToggle size="sm" />
          </div>

          {/* Mobile Menu Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg bg-white/10 dark:bg-dark-hover text-purple-300 hover:text-white transition-colors"
            aria-label="開啟選單"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden mt-4 pb-4 border-t border-white/10 dark:border-dark-border pt-4 animate-in slide-in-from-top-2 duration-200">
            <div className="space-y-3">
              {/* Role Switcher - Mobile */}
              <div className="flex flex-col gap-2">
                <p className="text-xs text-purple-300/50 uppercase tracking-wider mb-1">
                  切換角色
                </p>
                <button
                  type="button"
                  onClick={() => {
                    router.push("/dashboard/viewer");
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg text-left transition-all ${
                    isViewer
                      ? "bg-purple-600/30 text-purple-300 border border-purple-500/50"
                      : "bg-white/5 text-purple-300/70 hover:bg-white/10"
                  }`}
                >
                  <User size={18} />
                  <span>觀眾儀表板</span>
                  {isViewer && (
                    <span className="ml-auto text-xs bg-purple-500 px-2 py-0.5 rounded">
                      目前
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    router.push("/dashboard/streamer");
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg text-left transition-all ${
                    isStreamer
                      ? "bg-purple-600/30 text-purple-300 border border-purple-500/50"
                      : "bg-white/5 text-purple-300/70 hover:bg-white/10"
                  }`}
                >
                  <LayoutDashboard size={18} />
                  <span>實況主儀表板</span>
                  {isStreamer && (
                    <span className="ml-auto text-xs bg-purple-500 px-2 py-0.5 rounded">
                      目前
                    </span>
                  )}
                </button>
              </div>

              {/* Theme Switcher - Mobile */}
              <div className="pt-3 border-t border-white/10">
                <p className="text-xs text-purple-300/50 uppercase tracking-wider mb-2">
                  外觀設定
                </p>
                <div className="flex justify-center">
                  <ThemeToggle />
                </div>
              </div>

              {/* Settings & Logout - Mobile */}
              <div className="pt-3 border-t border-white/10 space-y-2">
                {isViewer && (
                  <button
                    type="button"
                    onClick={() => {
                      router.push("/dashboard/viewer/settings");
                      setMobileMenuOpen(false);
                    }}
                    className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-left bg-white/5 text-purple-300/70 hover:bg-white/10 transition-all"
                  >
                    <Settings size={18} />
                    <span>帳號設定</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-left bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-all"
                >
                  <LogOut size={18} />
                  <span>登出</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
