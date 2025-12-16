"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
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

import { isViewer } from "@/lib/api/auth"; // Import isViewer

export default function ViewerFootprintPage() {
  const params = useParams();
  const channelId = params.channelId as string;
  const { user, loading: authLoading } = useAuthSession();

  const [stats, setStats] = useState<LifetimeStatsResponse | null>(null);
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      // Wait for auth
      if (authLoading) return;

      // Check if user is viewer
      if (!user || !isViewer(user)) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        // Note: Backend ignores viewerId in path and uses token, so we can pass 'me' or user.id
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
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-slate-500 animate-pulse">正在載入足跡數據...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-slate-500">請先登入</div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="p-8 text-center mt-10">
        <h1 className="text-2xl font-bold text-slate-400 mb-2">
          無法載入足跡數據
        </h1>
        <p className="text-slate-500">
          {error || "找不到此頻道的統計資料或資料尚未生成"}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-slate-800 text-slate-300 rounded hover:bg-slate-700 transition"
        >
          重試
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto pb-20">
      <div className="mb-8 border-b border-slate-800/50 pb-6">
        <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
          觀眾足跡總覽
        </h1>
        <p className="text-slate-400">
          探索你在{" "}
          <span className="text-purple-400 font-medium">
            {stats.channelDisplayName || stats.channelName}
          </span>{" "}
          的互動歷程與成就
        </p>
      </div>

      <FootprintDashboard
        stats={stats}
        channelId={channelId}
        initialLayout={layout}
      />
    </div>
  );
}
