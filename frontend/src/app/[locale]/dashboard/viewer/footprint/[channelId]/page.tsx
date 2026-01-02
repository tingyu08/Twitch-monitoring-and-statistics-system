"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FootprintDashboard } from "@/features/viewer-dashboard/components/FootprintDashboard";
import {
  getLifetimeStats,
  LifetimeStatsResponse,
} from "@/lib/api/lifetime-stats";
import {
  getDashboardLayout,
  DashboardLayout,
} from "@/lib/api/dashboard-layout";
import { useAuthSession } from "@/features/auth/AuthContext";

import { isViewer } from "@/lib/api/auth";

export default function ViewerFootprintPage() {
  const t = useTranslations();
  const params = useParams();
  const router = useRouter();
  const channelId = params.channelId as string;
  const { user, loading: authLoading } = useAuthSession();

  const [stats, setStats] = useState<LifetimeStatsResponse | null>(null);
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (authLoading) return;

      if (!user || !isViewer(user)) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const vId = user.viewerId || "me";
        const [statsData, layoutData] = await Promise.all([
          getLifetimeStats(vId, channelId),
          getDashboardLayout(channelId),
        ]);

        setStats(statsData);
        setLayout(layoutData);
      } catch (err) {
        console.error(err);
        setError("無法載入數據");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [channelId, user, authLoading]);

  if (loading || authLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="theme-text-secondary animate-pulse">
          {t("common.loading")}
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-purple-300/70">{t("common.login")}</div>
      </main>
    );
  }

  if (error || !stats) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center theme-text-primary p-8">
        <h1 className="text-2xl font-bold theme-text-secondary mb-2">
          {t("channel.noData")}
        </h1>
        <p className="theme-text-muted mb-4">{error || t("channel.noData")}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 theme-btn-primary rounded-xl transition"
        >
          {t("common.retry")}
        </button>
      </main>
    );
  }

  return (
    <main className="theme-main-bg theme-text-primary">
      {/* Header Bar */}
      <header className="border-b border-purple-300 dark:border-white/10 backdrop-blur-md bg-white/70 dark:bg-black/20 sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-2 text-sm theme-text-secondary">
          <button
            onClick={() => router.push("/dashboard/viewer")}
            className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            {t("nav.viewerDashboard")}
          </button>
          <span>/</span>
          <button
            onClick={() => router.push(`/dashboard/viewer/${channelId}`)}
            className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            {stats.channelDisplayName || stats.channelName}
          </button>
          <span>/</span>
          <span className="theme-text-primary">
            {t("channel.viewFootprint")}
          </span>
        </div>
      </header>

      <div className="p-3 sm:p-4 lg:p-6 max-w-[1600px] mx-auto pb-20">
        {/* Page Header */}
        <section className="mb-6 sm:mb-8 theme-header-card p-4 sm:p-6">
          <h1 className="text-2xl sm:text-3xl theme-text-gradient mb-2 tracking-tight">
            {t("footprint.title")}
          </h1>
          <p className="theme-text-secondary text-sm sm:text-base">
            {t("footprint.subtitle", {
              channel: stats.channelDisplayName || stats.channelName,
            })}
          </p>
        </section>

        <FootprintDashboard
          stats={stats}
          channelId={channelId}
          initialLayout={layout}
        />
      </div>
    </main>
  );
}
