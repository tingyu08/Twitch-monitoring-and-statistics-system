"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@/features/auth/AuthContext";
import { viewerApi, type FollowedChannel } from "@/lib/api/viewer";
import { isViewer } from "@/lib/api/auth";

export default function ViewerDashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuthSession();
  const [channels, setChannels] = useState<FollowedChannel[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredChannels, setFilteredChannels] = useState<FollowedChannel[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push("/");
      return;
    }

    if (isViewer(user) && !user.consentedAt) {
      router.push("/auth/viewer/consent");
      return;
    }

    loadChannels();
  }, [authLoading, user, router]);

  const loadChannels = async () => {
    try {
      setLoading(true);
      const data = await viewerApi.getFollowedChannels();
      setChannels(data);
      setFilteredChannels(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入頻道失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      setFilteredChannels(
        channels.filter(
          (ch) =>
            ch.channelName.toLowerCase().includes(lowerQuery) ||
            ch.displayName.toLowerCase().includes(lowerQuery)
        )
      );
    } else {
      setFilteredChannels(channels);
    }
  }, [searchQuery, channels]);

  const handleChannelClick = (channelId: string) => {
    router.push(`/dashboard/viewer/${channelId}`);
  };

  if (authLoading || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-400"></div>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const viewerUser = isViewer(user) ? user : null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header Bar */}
      <header className="border-b border-white/10 backdrop-blur-sm bg-black/20 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="text-xs text-purple-300/70 font-mono tracking-wider">
            VIEWER DASHBOARD
          </div>

          {/* Radio Button Style Switcher */}
          <div className="flex bg-white/10 rounded-lg p-1 border border-white/10">
            <button
              type="button"
              className="px-3 py-1 rounded-md text-xs font-medium bg-purple-600 text-white shadow-sm cursor-default"
            >
              觀眾
            </button>
            <button
              type="button"
              onClick={() => router.push("/dashboard/streamer")}
              className="px-3 py-1 rounded-md text-xs font-medium text-purple-300 hover:text-white transition-all hover:bg-white/10"
            >
              實況主
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* User Header */}
        <section className="mb-10 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              {viewerUser?.avatarUrl && (
                <Image
                  src={viewerUser.avatarUrl}
                  alt={viewerUser.displayName}
                  width={80}
                  height={80}
                  className="w-20 h-20 rounded-full border-4 border-purple-500/50 object-cover ring-4 ring-purple-500/20"
                  unoptimized
                />
              )}
              <div>
                <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                  歡迎回來，{viewerUser?.displayName || "觀眾"}
                </h1>
                <p className="text-purple-300/70 mt-1">
                  追蹤你的觀看數據與互動紀錄
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push("/dashboard/viewer/settings")}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm text-purple-300 transition-colors border border-white/10 flex items-center gap-2"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                帳號設定
              </button>
              <button
                type="button"
                onClick={logout}
                className="px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-sm text-red-300 transition-colors border border-red-500/20"
              >
                登出
              </button>
            </div>
          </div>
        </section>

        {/* 搜尋與標題 */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
            已追蹤的頻道
          </h2>
          <div className="relative">
            <input
              id="channel-search-input"
              name="searchQuery"
              type="text"
              placeholder="搜尋頻道..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-64 px-4 py-2 bg-white/10 border border-white/10 rounded-xl text-white placeholder-purple-300/50 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all backdrop-blur-sm"
            />
            <svg
              className="absolute right-3 top-2.5 h-5 w-5 text-purple-300/50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl backdrop-blur-sm">
            {error}
          </div>
        )}

        {/* 頻道列表 */}
        {filteredChannels.length === 0 ? (
          <div className="text-center py-20 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 border-dashed">
            <p className="text-purple-300/70 mb-4 text-lg">
              {searchQuery ? "找不到符合的頻道" : "您尚未追蹤任何頻道"}
            </p>
            {!searchQuery && (
              <button
                type="button"
                className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-500 hover:to-pink-500 transition-all font-medium shadow-lg shadow-purple-900/30"
              >
                開始探索實況主
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredChannels.map((channel) => (
              <button
                key={channel.id}
                type="button"
                onClick={() => handleChannelClick(channel.id)}
                className="group bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 hover:border-purple-500/50 p-5 text-left transition-all duration-300 hover:shadow-lg hover:shadow-purple-900/20 hover:-translate-y-1 hover:bg-white/15"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative">
                    <Image
                      src={channel.avatarUrl}
                      alt={channel.displayName}
                      width={60}
                      height={60}
                      className="w-14 h-14 rounded-full object-cover border-2 border-white/20 group-hover:border-purple-500 transition-colors"
                      unoptimized
                    />
                    {channel.isLive && (
                      <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-slate-800 animate-pulse" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-white group-hover:text-purple-300 transition-colors">
                      {channel.displayName}
                    </h3>
                    <p className="text-sm text-purple-300/50 font-mono">
                      @{channel.channelName}
                    </p>
                    {channel.isLive && (
                      <span className="inline-block mt-1 text-[10px] uppercase tracking-wider text-red-400 font-bold bg-red-500/20 px-1.5 py-0.5 rounded">
                        LIVE
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-xl p-3 border border-blue-500/20">
                    <p className="text-blue-300/70 text-xs mb-1">觀看時數</p>
                    <p className="font-semibold text-blue-400 text-lg">
                      {(channel.totalWatchMinutes / 60).toFixed(1)}{" "}
                      <span className="text-xs text-blue-400/60">h</span>
                    </p>
                  </div>
                  <div className="bg-gradient-to-br from-green-500/20 to-green-600/10 rounded-xl p-3 border border-green-500/20">
                    <p className="text-green-300/70 text-xs mb-1">留言數</p>
                    <p className="font-semibold text-green-400 text-lg">
                      {channel.messageCount}
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-white/10 text-xs text-purple-300/50 flex justify-between items-center">
                  <span>最後觀看</span>
                  <span className="text-purple-300 font-medium">
                    {channel.lastWatched
                      ? channel.lastWatched.split("T")[0]
                      : "N/A"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
