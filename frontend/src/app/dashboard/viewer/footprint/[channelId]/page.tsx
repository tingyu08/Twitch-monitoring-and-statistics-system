"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-purple-300 animate-pulse">正在載入足跡數據...</div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-purple-300/70">請先登入</div>
      </main>
    );
  }

  if (error || !stats) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-8">
        <h1 className="text-2xl font-bold text-purple-300 mb-2">
          無法載入足跡數據
        </h1>
        <p className="text-purple-300/50 mb-4">
          {error || "找不到此頻道的統計資料或資料尚未生成"}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-white/10 backdrop-blur-sm text-purple-300 rounded-xl hover:bg-white/20 transition border border-white/10"
        >
          重試
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header Bar */}
      <header className="border-b border-white/10 backdrop-blur-sm bg-black/20">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-2 text-sm text-purple-300/70">
          <button
            onClick={() => router.push("/dashboard/viewer")}
            className="hover:text-purple-400 transition-colors"
          >
            觀眾儀表板
          </button>
          <span>/</span>
          <button
            onClick={() => router.push(`/dashboard/viewer/${channelId}`)}
            className="hover:text-purple-400 transition-colors"
          >
            {stats.channelDisplayName || stats.channelName}
          </button>
          <span>/</span>
          <span className="text-white">成就足跡</span>
        </div>
      </header>

      <div className="p-4 lg:p-6 max-w-[1600px] mx-auto pb-20">
        {/* Page Header */}
        <section className="mb-8 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-2 tracking-tight">
            觀眾足跡總覽
          </h1>
          <p className="text-purple-300/70">
            探索你在{" "}
            <span className="text-purple-400 font-medium">
              {stats.channelDisplayName || stats.channelName}
            </span>{" "}
            的互動歷程與成就
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
