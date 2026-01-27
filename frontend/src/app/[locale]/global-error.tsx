"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Global Error Boundary for root layout errors
 * This catches errors in the root layout itself
 * Note: Must include its own <html> and <body> tags
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Log error to console in development only
    if (process.env.NODE_ENV === "development") {
      console.error("[Global Error Boundary]", error);
    }
    // TODO: Send to error tracking service (e.g., Sentry) in production
  }, [error]);

  return (
    <html lang="zh-TW">
      <body className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
        <main className="min-h-screen flex items-center justify-center p-4">
          <div className="max-w-md w-full text-center">
            {/* Error Icon */}
            <div className="mb-6 flex justify-center">
              <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-10 h-10 text-red-400" />
              </div>
            </div>

            {/* Error Message */}
            <h1 className="text-2xl font-bold text-white mb-2">
              發生嚴重錯誤
            </h1>
            <p className="text-gray-300 mb-6">
              應用程式發生嚴重錯誤，請重新整理頁面。
            </p>

            {/* Error Details (development only) */}
            {process.env.NODE_ENV === "development" && (
              <div className="mb-6 p-4 bg-red-500/10 rounded-xl border border-red-500/20 text-left">
                <p className="text-sm font-mono text-red-300 break-all">
                  {error.message}
                </p>
                {error.digest && (
                  <p className="text-xs text-gray-400 mt-2">
                    Error ID: {error.digest}
                  </p>
                )}
              </div>
            )}

            {/* Action Button */}
            <button
              type="button"
              onClick={reset}
              className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-500 hover:to-purple-700 rounded-xl font-medium transition-all transform hover:-translate-y-0.5 flex items-center justify-center gap-2 mx-auto"
            >
              <RefreshCw className="w-4 h-4" />
              重新整理
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
