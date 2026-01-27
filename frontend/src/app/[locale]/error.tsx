"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Error Boundary for [locale] routes
 * Catches and displays errors in a user-friendly way
 */
export default function Error({ error, reset }: ErrorProps) {
  const t = useTranslations();

  useEffect(() => {
    // Log error to console in development only
    if (process.env.NODE_ENV === "development") {
      console.error("[Error Boundary]", error);
    }
    // TODO: Send to error tracking service (e.g., Sentry) in production
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center theme-main-bg theme-text-primary p-4">
      <div className="max-w-md w-full text-center">
        {/* Error Icon */}
        <div className="mb-6 flex justify-center">
          <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-500/20 flex items-center justify-center">
            <AlertTriangle className="w-10 h-10 text-red-600 dark:text-red-400" />
          </div>
        </div>

        {/* Error Message */}
        <h1 className="text-2xl font-bold theme-text-primary mb-2">
          {t("error.title", { defaultValue: "發生錯誤" })}
        </h1>
        <p className="theme-text-secondary mb-6">
          {t("error.description", {
            defaultValue: "頁面載入時發生錯誤，請重新整理或返回首頁。",
          })}
        </p>

        {/* Error Details (development only) */}
        {process.env.NODE_ENV === "development" && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-500/10 rounded-xl border border-red-200 dark:border-red-500/20 text-left">
            <p className="text-sm font-mono text-red-700 dark:text-red-300 break-all">
              {error.message}
            </p>
            {error.digest && (
              <p className="text-xs theme-text-muted mt-2">
                Error ID: {error.digest}
              </p>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            type="button"
            onClick={reset}
            className="px-6 py-2.5 theme-btn-primary rounded-xl font-medium transition-all transform hover:-translate-y-0.5 flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            {t("error.retry", { defaultValue: "重新整理" })}
          </button>
          <a
            href="/"
            className="px-6 py-2.5 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 rounded-xl font-medium transition-all transform hover:-translate-y-0.5 flex items-center justify-center gap-2 theme-text-primary"
          >
            <Home className="w-4 h-4" />
            {t("error.home", { defaultValue: "返回首頁" })}
          </a>
        </div>
      </div>
    </main>
  );
}
