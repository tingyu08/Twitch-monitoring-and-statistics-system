"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { HttpClientError, httpClient } from "@/lib/api/httpClient";

export function isHttpClient401Instance(error: unknown) {
  return error instanceof HttpClientError && error.status === 401;
}

export function hasStatus401(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error && error.status === 401;
}

export function isUnauthorizedConsentError(error: unknown) {
  return isHttpClient401Instance(error) || hasStatus401(error);
}

export function buildConsentBannerHandlers(args: {
  router: { push: (path: string) => void };
  setShowBanner: (value: boolean) => void;
}) {
  const handleCustomize = () => {
    localStorage.setItem("consent_banner_shown", "true");
    args.setShowBanner(false);
    args.router.push("/dashboard/viewer/settings?mode=privacy");
  };

  return { handleCustomize };
}

interface ConsentBannerProps {
  onAcceptAll: () => void;
  onCustomize: () => void;
}

export function ConsentBanner({ onAcceptAll, onCustomize }: ConsentBannerProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 shadow-lg z-50">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row items-center gap-6">
          {/* 說明文字 */}
          <div className="flex-1 text-gray-300">
            <h3 className="text-lg font-semibold text-white mb-2">🔒 我們重視您的隱私</h3>
            <p className="text-sm">
              Twitch Analytics
              會收集您的觀看時數、互動統計和成就進度，以為您提供個人化的分析儀表板。您可以隨時在設定中調整這些偏好，或完全停用資料收集。
            </p>
            <p className="text-sm mt-2">
              閱讀我們的{" "}
              <a href="/privacy-policy" className="text-purple-400 underline hover:text-purple-300">
                隱私政策
              </a>{" "}
              了解更多。
            </p>
          </div>

          {/* 按鈕區 */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={onAcceptAll}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors"
            >
              接受全部
            </button>
            <button
              onClick={onCustomize}
              className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
            >
              自訂設定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * ConsentBanner 包裝器 - 處理顯示邏輯
 */
export function ConsentBannerWrapper() {
  const router = useRouter();
  const [showBanner, setShowBanner] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkConsent = async () => {
      try {
        // 先檢查 localStorage 是否已顯示過
        const hasShownBanner = localStorage.getItem("consent_banner_shown");
        if (hasShownBanner) {
          setIsLoading(false);
          return;
        }

        // Check API for consent record
        // httpClient handles base URL and credentials automatically
        const data = await httpClient<{ hasConsent: boolean }>("/api/viewer/pref/status", {
          silentStatuses: [401],
        });

        if (!data.hasConsent) {
          setShowBanner(true);
        }
      } catch (error) {
        if (isUnauthorizedConsentError(error)) {
          return;
        }

        // Log error but don't crash - just won't show banner if API fails
        console.error("無法檢查同意狀態:", error);
      } finally {
        setIsLoading(false);
      }
    };

    checkConsent();
  }, []);

  const handleAcceptAll = async () => {
    try {
      await httpClient("/api/viewer/pref/opt-all", {
        method: "POST",
      });

      localStorage.setItem("consent_banner_shown", "true");
      setShowBanner(false);
    } catch (error) {
      console.error("接受同意失敗:", error);
    }
  };

  const handleCustomize = () => {
    buildConsentBannerHandlers({
      router,
      setShowBanner,
    }).handleCustomize();
  };

  if (isLoading || !showBanner) {
    return null;
  }

  return <ConsentBanner onAcceptAll={handleAcceptAll} onCustomize={handleCustomize} />;
}
