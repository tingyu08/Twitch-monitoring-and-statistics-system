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
      <main className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const viewerUser = isViewer(user) ? user : null;

  return (
    <main className="min-h-screen bg-gray-900 text-white">
      {/* 頂部快捷列 & 身分切換 (Radio Style) */}
      <div className="border-b border-gray-800 bg-gray-900/50 sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-2 flex justify-between items-center">
          <div className="text-xs text-gray-500 font-mono tracking-wider">
            VIEWER DASHBOARD
          </div>

          {/* Radio Button Style Switcher */}
          <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700">
            <button
              type="button"
              className="px-3 py-1 rounded-md text-xs font-medium bg-purple-600 text-white shadow-sm shadow-purple-900/20 cursor-default"
            >
              觀眾
            </button>
            <button
              type="button"
              onClick={() => router.push("/dashboard/streamer")}
              className="px-3 py-1 rounded-md text-xs font-medium text-gray-400 hover:text-white transition-all hover:bg-gray-700/50"
            >
              實況主
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-10 border-b border-gray-800 pb-6 flex justify-between items-end">
          <div className="flex items-center gap-5">
            {viewerUser?.avatarUrl && (
              <Image
                src={viewerUser.avatarUrl}
                alt={viewerUser.displayName}
                width={64}
                height={64}
                className="w-16 h-16 rounded-full border-2 border-purple-500 object-cover shadow-lg shadow-purple-500/20"
                unoptimized
              />
            )}
            <div>
              <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                歡迎回來，{viewerUser?.displayName || "觀眾"}
              </h1>
              <p className="text-gray-400 mt-1">追蹤你的觀看數據與互動紀錄</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/dashboard/viewer/settings")}
              className="px-4 py-2 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors border border-gray-700 flex items-center gap-2"
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
              className="px-4 py-2 rounded bg-gray-800 hover:bg-red-900/30 text-sm text-gray-300 hover:text-red-400 transition-colors border border-gray-700 hover:border-red-900/50"
            >
              登出
            </button>
          </div>
        </header>

        {/* 搜尋與標題 */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-purple-200 border-l-4 border-purple-500 pl-3">
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
              className="w-full sm:w-64 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            />
            <svg
              className="absolute right-3 top-2.5 h-5 w-5 text-gray-500"
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
          <div className="mb-6 p-4 bg-red-900/30 border border-red-800 text-red-200 rounded-lg">
            {error}
          </div>
        )}

        {/* 頻道列表 */}
        {filteredChannels.length === 0 ? (
          <div className="text-center py-20 bg-gray-800/50 rounded-xl border border-gray-700 border-dashed">
            <p className="text-gray-400 mb-4 text-lg">
              {searchQuery ? "找不到符合的頻道" : "您尚未追蹤任何頻道"}
            </p>
            {!searchQuery && (
              <button
                type="button"
                className="px-6 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium shadow-lg shadow-purple-900/30"
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
                className="group bg-gray-800 rounded-xl border border-gray-700 hover:border-purple-500/50 p-5 text-left transition-all duration-200 hover:shadow-lg hover:shadow-purple-900/10 hover:-translate-y-1"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative">
                    <Image
                      src={channel.avatarUrl}
                      alt={channel.displayName}
                      width={60}
                      height={60}
                      className="w-14 h-14 rounded-full object-cover border-2 border-gray-700 group-hover:border-purple-500 transition-colors"
                      unoptimized
                    />
                    {channel.isLive && (
                      <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-gray-800 animate-pulse" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-gray-100 group-hover:text-purple-300 transition-colors">
                      {channel.displayName}
                    </h3>
                    <p className="text-sm text-gray-500 font-mono">
                      @{channel.channelName}
                    </p>
                    {channel.isLive && (
                      <span className="inline-block mt-1 text-[10px] uppercase tracking-wider text-red-400 font-bold bg-red-900/20 px-1.5 py-0.5 rounded">
                        LIVE
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/50">
                    <p className="text-gray-500 text-xs mb-1">觀看時數</p>
                    <p className="font-semibold text-blue-300 text-lg">
                      {(channel.totalWatchMinutes / 60).toFixed(1)}{" "}
                      <span className="text-xs text-gray-600">h</span>
                    </p>
                  </div>
                  <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/50">
                    <p className="text-gray-500 text-xs mb-1">留言數</p>
                    <p className="font-semibold text-green-300 text-lg">
                      {channel.messageCount}
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-700 text-xs text-gray-500 flex justify-between items-center">
                  <span>最後觀看</span>
                  <span className="text-gray-400 font-medium">
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
