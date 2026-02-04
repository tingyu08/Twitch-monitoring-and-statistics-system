"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useAuthSession } from "@/features/auth/AuthContext";
import { ThemeToggle } from "@/features/theme";
import LocaleSwitcher from "@/components/LocaleSwitcher";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://127.0.0.1:4000";

function LandingPageContent() {
  const t = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, loading } = useAuthSession();
  const authError = searchParams.get("authError");

  // 如果已登入，導向儀表板切換頁（保持當前語言）
  useEffect(() => {
    if (!loading && user) {
      router.push(`/${locale}/dashboard/viewer`);
    }
  }, [loading, user, router, locale]);

  const handleLogin = () => {
    // 清除登出標誌，允許重新登入
    if (typeof window !== "undefined") {
      localStorage.removeItem("logout_pending");
    }
    // 統一登入：一次授權即可同時存取實況主與觀眾功能
    window.location.href = "/api/auth/login";
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-purple-700 dark:text-purple-300">{t("common.loading")}</p>
      </main>
    );
  }

  if (user) {
    return null; // 正在導向
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-4">
      {/* 右上角控制項 */}
      <div className="absolute top-4 right-4 flex items-center gap-3">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>

      <h1 className="text-3xl font-bold text-center text-purple-900 dark:text-white drop-shadow-sm">
        {t("home.title")}
      </h1>
      <p className="text-purple-700 dark:text-purple-300 text-center max-w-lg">
        {t("home.description")}
      </p>

      {authError && (
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded mb-4 max-w-md">
          <p className="font-bold mb-2">{t("home.loginFailed")}</p>
          <p className="text-sm">
            {authError === "authorization_failed"
              ? t("home.authErrors.authorizationFailed")
              : authError === "callback_exception"
                ? t("home.authErrors.callbackException")
                : t("home.authErrors.unknown")}
          </p>
        </div>
      )}

      <div className="w-full max-w-md theme-card p-6 shadow-sm space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
          {t("home.loginHint")}
        </p>
        <button
          type="button"
          onClick={handleLogin}
          className="w-full px-4 py-3 rounded theme-btn-primary"
        >
          {t("home.loginButton")}
        </button>
      </div>
    </main>
  );
}

export default function LandingPage() {
  const t = useTranslations();

  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-purple-700 dark:text-purple-300">{t("common.loading")}</p>
        </main>
      }
    >
      <LandingPageContent />
    </Suspense>
  );
}
