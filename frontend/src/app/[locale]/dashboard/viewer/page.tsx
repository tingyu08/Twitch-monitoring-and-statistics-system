"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useAuthSession } from "@/features/auth/AuthContext";
import { viewerApi, type FollowedChannel } from "@/lib/api/viewer";
import { isViewer } from "@/lib/api/auth";
import { useSocket } from "@/lib/socket";
import { DashboardHeader } from "@/components";

// 每頁顯示的頻道數量
const CHANNELS_PER_PAGE = 24;

// 計算並格式化開台時長
function formatStreamDuration(startedAt: string): string {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export default function ViewerDashboardPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuthSession();
  const [channels, setChannels] = useState<FollowedChannel[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredChannels, setFilteredChannels] = useState<FollowedChannel[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 分頁狀態
  const [currentPage, setCurrentPage] = useState(1);
  const lastNotifiedChannelsRef = useRef<string>("");

  const { socket, connected: socketConnected } = useSocket();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push("/");
      return;
    }

    // (Consent check removed for unified login)

    loadChannels();

    // WebSocket 即時更新邏輯
    if (socket && socketConnected) {
      const handleUpdate = (data: {
        channelId: string;
        messageCount: number;
      }) => {
        setChannels((prev) =>
          prev.map((ch) => {
            if (ch.id === data.channelId) {
              return {
                ...ch,
                messageCount: ch.messageCount + data.messageCount,
              };
            }
            return ch;
          })
        );
      };

      socket.on("stats-update", handleUpdate);
      return () => {
        socket.off("stats-update", handleUpdate);
      };
    }
  }, [authLoading, user, router, socket, socketConnected]);

  const loadChannels = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await viewerApi.getFollowedChannels();
      setChannels(data);
    } catch (err) {
      if (!silent)
        setError(err instanceof Error ? err.message : "載入頻道失敗");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // 過濾頻道
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
      // 搜尋時重置到第一頁
      setCurrentPage(1);
    } else {
      setFilteredChannels(channels);
    }
  }, [searchQuery, channels]);

  // 計算分頁
  const totalPages = Math.ceil(filteredChannels.length / CHANNELS_PER_PAGE);
  const startIndex = (currentPage - 1) * CHANNELS_PER_PAGE;
  const endIndex = startIndex + CHANNELS_PER_PAGE;
  const currentPageChannels = filteredChannels.slice(startIndex, endIndex);

  // 通知後端監聽當前頁面的開台頻道
  const notifyListenChannels = useCallback(
    async (channelsToListen: FollowedChannel[]) => {
      const liveChannels = channelsToListen
        .filter((ch) => ch.isLive)
        .map((ch) => ({ channelName: ch.channelName, isLive: true }));

      // 建立唯一識別碼避免重複通知
      const channelKey = liveChannels
        .map((ch) => ch.channelName)
        .sort()
        .join(",");
      if (channelKey === lastNotifiedChannelsRef.current) {
        return; // 相同的頻道列表，不重複通知
      }
      lastNotifiedChannelsRef.current = channelKey;

      if (liveChannels.length > 0) {
        await viewerApi.setListenChannels(liveChannels);
      }
    },
    []
  );

  // 當頁面變更時通知後端
  useEffect(() => {
    if (currentPageChannels.length > 0) {
      notifyListenChannels(currentPageChannels);
    }
  }, [currentPage, currentPageChannels, notifyListenChannels]);

  const handleChannelClick = (channelId: string) => {
    router.push(`/dashboard/viewer/${channelId}`);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // 滾動到頂部
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (authLoading || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-400"></div>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const viewerUser = isViewer(user) ? user : null;

  return (
    <main className="min-h-screen">
      {/* 使用新的響應式 Header */}
      <DashboardHeader variant="viewer" />

      <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6 md:py-8">
        {/* User Header - 響應式設計 */}
        <section className="mb-6 sm:mb-8 md:mb-10 theme-header-card p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6">
            <div className="flex items-center gap-3 sm:gap-5">
              {viewerUser?.avatarUrl && (
                <Image
                  src={viewerUser.avatarUrl}
                  alt={viewerUser.displayName}
                  width={80}
                  height={80}
                  className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-full border-2 sm:border-4 border-purple-500/50 object-cover ring-2 sm:ring-4 ring-purple-500/20"
                  unoptimized
                />
              )}
              <div>
                <h1 className="text-xl sm:text-2xl md:text-3xl theme-text-gradient">
                  {t("viewer.welcome", {
                    name:
                      viewerUser?.displayName ||
                      t("viewer.welcomeGuest").replace("Welcome back, ", ""),
                  })}
                </h1>
                <p className="text-sm sm:text-base theme-text-secondary mt-0.5 sm:mt-1">
                  {t("viewer.subtitle")}
                </p>
              </div>
            </div>
            {/* 桌面版按鈕 - 在移動端隱藏，使用 Header 選單 */}
            <div className="hidden md:flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push("/dashboard/viewer/settings")}
                className="px-4 py-2 rounded-lg bg-white/50 hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/20 text-sm theme-text-secondary transition-colors border border-purple-200 dark:border-white/10 flex items-center gap-2"
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
                {t("nav.settings")}
              </button>
              <button
                type="button"
                onClick={logout}
                className="px-4 py-2 rounded-lg bg-red-100 dark:bg-red-500/20 hover:bg-red-200 dark:hover:bg-red-500/30 text-sm text-red-700 dark:text-red-300 transition-colors border border-red-200 dark:border-red-500/20"
              >
                {t("common.logout")}
              </button>
            </div>
          </div>
        </section>

        {/* 搜尋與標題 */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold theme-text-gradient">
              {t("viewer.followedChannels")}
            </h2>
            <span className="text-sm text-purple-600/60 dark:text-purple-500">
              ({filteredChannels.length} 個頻道
              {totalPages > 1 ? ` · 第 ${currentPage}/${totalPages} 頁` : ""})
            </span>
          </div>
          <div className="relative">
            <input
              id="channel-search-input"
              name="searchQuery"
              type="text"
              placeholder={t("viewer.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-64 px-4 py-2 bg-white/50 dark:bg-white/10 border border-purple-200 dark:border-white/10 rounded-xl theme-text-primary placeholder-purple-400 dark:placeholder-purple-300/50 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all backdrop-blur-sm"
            />
            <svg
              className="absolute right-3 top-2.5 h-5 w-5 text-purple-400 dark:text-purple-300/50"
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
          <div className="text-center py-20 bg-white/40 dark:bg-white/5 backdrop-blur-sm rounded-2xl border border-purple-300 dark:border-white/10 border-dashed">
            <p className="text-purple-800/80 dark:text-purple-300/70 mb-4 text-lg">
              {searchQuery
                ? t("viewer.noChannels")
                : t("viewer.noFollowedChannels")}
            </p>
            {!searchQuery && (
              <button
                type="button"
                className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-500 hover:to-pink-500 transition-all font-medium shadow-lg shadow-purple-900/30"
              >
                {t("viewer.exploreStreamers")}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {currentPageChannels.map((channel) => (
                <div
                  key={channel.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleChannelClick(channel.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      handleChannelClick(channel.id);
                    }
                  }}
                  className="group cursor-pointer bg-white/40 dark:bg-white/10 backdrop-blur-sm rounded-2xl border border-purple-300 dark:border-white/10 hover:border-purple-500/50 p-5 text-left transition-all duration-300 hover:shadow-lg hover:shadow-purple-900/10 hover:-translate-y-1 hover:bg-white/50 dark:hover:bg-white/15"
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
                      <h3 className="font-bold text-lg text-purple-900 dark:text-white group-hover:text-purple-700 dark:group-hover:text-purple-300 transition-colors">
                        {channel.displayName}
                      </h3>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm text-purple-800/60 dark:text-purple-300/50 font-mono">
                          @{channel.channelName}
                        </p>
                        {channel.isLive && (
                          <a
                            href={`https://twitch.tv/${channel.channelName}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-purple-500 hover:text-purple-700 dark:text-purple-400 dark:hover:text-white hover:underline flex items-center gap-0.5 transition-colors z-10 relative"
                          >
                            {t("viewer.watchNow")}
                            <svg
                              className="w-3 h-3"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                              />
                            </svg>
                          </a>
                        )}
                      </div>
                      {channel.isLive && channel.category && (
                        <p className="text-xs text-purple-400/70 mt-0.5 truncate max-w-[180px]">
                          🎮 {channel.category}
                        </p>
                      )}
                      {channel.isLive && (
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] uppercase tracking-wider text-red-400 font-bold bg-red-500/20 px-1.5 py-0.5 rounded">
                            LIVE
                          </span>
                          {channel.viewerCount !== null && (
                            <span className="text-[10px] text-purple-800/70 dark:text-purple-300/70">
                              {t("viewer.viewers", {
                                count: channel.viewerCount.toLocaleString(),
                              })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 開台時間顯示 (僅開台時) */}
                  {channel.isLive && channel.streamStartedAt && (
                    <div className="mb-3 px-3 py-2 bg-red-500/10 rounded-lg border border-red-500/20">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-red-300/70">
                          {t("viewer.streamDuration")}
                        </span>
                        <span className="text-red-400 font-mono">
                          {formatStreamDuration(channel.streamStartedAt)}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-blue-600/5 dark:bg-blue-500/10 rounded-xl p-3 border border-blue-200 dark:border-blue-500/20">
                      <p className="text-blue-800 dark:text-blue-300/70 text-xs mb-1">
                        {t("stats.watchHours")}
                      </p>
                      <p className="font-semibold text-blue-900 dark:text-blue-400 text-lg">
                        {(channel.totalWatchMinutes / 60).toFixed(1)}{" "}
                        <span className="text-xs text-blue-700/60 dark:text-blue-400/60">
                          h
                        </span>
                      </p>
                    </div>
                    <div className="bg-green-600/5 dark:bg-green-500/10 rounded-xl p-3 border border-green-200 dark:border-green-500/20">
                      <p className="text-green-800 dark:text-green-300/70 text-xs mb-1">
                        {t("stats.messageCount")}
                      </p>
                      <p className="font-semibold text-green-900 dark:text-green-400 text-lg">
                        {channel.messageCount}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-purple-200 dark:border-white/10 text-xs text-purple-800/60 dark:text-purple-300/50 space-y-1">
                    <div className="flex justify-between items-center">
                      <span>{t("viewer.lastWatched")}</span>
                      <span className="text-purple-900 dark:text-purple-300 font-medium">
                        {channel.lastWatched
                          ? channel.lastWatched.split("T")[0]
                          : "N/A"}
                      </span>
                    </div>
                    {channel.followedAt && (
                      <div className="flex justify-between items-center">
                        <span>{t("viewer.followedAt")}</span>
                        <span className="text-purple-900 dark:text-purple-300 font-medium">
                          {channel.followedAt.split("T")[0]}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* 分頁導航 */}
            {totalPages > 1 && (
              <div className="mt-8 flex justify-center items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm text-purple-300 transition-colors border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ← {t("viewer.prevPage")}
                </button>

                <div className="flex gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((page) => {
                      // 顯示前3頁、後3頁、當前頁附近3頁
                      if (page <= 3) return true;
                      if (page >= totalPages - 2) return true;
                      if (Math.abs(page - currentPage) <= 1) return true;
                      return false;
                    })
                    .map((page, index, arr) => (
                      <>
                        {index > 0 && arr[index - 1] !== page - 1 && (
                          <span
                            key={`ellipsis-${page}`}
                            className="px-2 text-purple-300/50"
                          >
                            ...
                          </span>
                        )}
                        <button
                          key={page}
                          type="button"
                          onClick={() => handlePageChange(page)}
                          className={`w-10 h-10 rounded-lg text-sm font-medium transition-all ${
                            currentPage === page
                              ? "bg-purple-600 text-white shadow-lg shadow-purple-900/30"
                              : "bg-white/10 text-purple-300 hover:bg-white/20 border border-white/10"
                          }`}
                        >
                          {page}
                        </button>
                      </>
                    ))}
                </div>

                <button
                  type="button"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm text-purple-300 transition-colors border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t("viewer.nextPage")} →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
