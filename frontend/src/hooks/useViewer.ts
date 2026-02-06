/**
 * React Query Hooks for Viewer API
 * P1 優化：統一管理 Viewer 相關的資料請求，自動處理快取和去重
 */

import { useQuery, UseQueryResult, useQueryClient } from "@tanstack/react-query";
import { viewerApi } from "@/lib/api/viewer";
import type {
  FollowedChannel,
  ViewerChannelStats,
  ViewerMessageStatsResponse,
  GameStats,
  ViewerTrendPoint,
} from "@/lib/api/viewer";

/**
 * 取得追蹤的頻道列表
 * P1 Optimization: 使用 refetchInterval 自動更新觀眾數
 * 取代原本的 WebSocket channel.update 和 stats-update 事件
 */
export function useChannels() {
  const queryClient = useQueryClient();

  const mergeChannels = (fresh: FollowedChannel[], prev?: FollowedChannel[]) => {
    if (!prev || prev.length === 0) return fresh;
    const prevMap = new Map(prev.map((ch) => [ch.id, ch]));

    return fresh.map((channel) => {
      const previous = prevMap.get(channel.id);
      if (!previous) return channel;

      const prevViewer = previous.viewerCount ?? previous.currentViewerCount ?? 0;
      const freshViewer = channel.viewerCount ?? channel.currentViewerCount ?? 0;
      const mergedViewer =
        channel.isLive && previous.isLive ? Math.max(freshViewer, prevViewer) : freshViewer;

      return {
        ...channel,
        viewerCount: mergedViewer || channel.viewerCount,
        currentViewerCount: mergedViewer || channel.currentViewerCount,
        currentTitle: channel.currentTitle || previous.currentTitle,
        currentGameName: channel.currentGameName || previous.currentGameName,
        currentStreamStartedAt: channel.currentStreamStartedAt || previous.currentStreamStartedAt,
        messageCount: Math.max(channel.messageCount ?? 0, previous.messageCount ?? 0),
      };
    });
  };

  return useQuery<FollowedChannel[], Error>({
    queryKey: ["viewer", "channels"],
    queryFn: () => viewerApi.getFollowedChannels(),
    staleTime: 30 * 1000, // 30 秒內視為新鮮
    gcTime: 5 * 60 * 1000, // 5 分鐘後清除快取
    refetchInterval: false,
    refetchIntervalInBackground: false, // 背景時不輪詢，節省資源
    refetchOnWindowFocus: false, // 避免與可見性手動刷新重複
    select: (data) => mergeChannels(data, queryClient.getQueryData(["viewer", "channels"]) as FollowedChannel[] | undefined),
  });
}

/**
 * 取得頻道詳細資料（BFF 聚合端點）
 * 一次取得：channelStats + messageStats + gameStats + viewerTrends
 */
export function useChannelDetail(channelId: string, days = 30) {
  return useQuery<
    {
      channelStats: ViewerChannelStats | null;
      messageStats: ViewerMessageStatsResponse | null;
      gameStats: GameStats[] | null;
      viewerTrends: ViewerTrendPoint[] | null;
    } | null,
    Error
  >({
    queryKey: ["viewer", "channel-detail", channelId, days],
    queryFn: () => viewerApi.getChannelDetailAll(channelId, days),
    staleTime: 60 * 1000, // 1 分鐘內視為新鮮（詳細頁資料變化較慢）
    gcTime: 10 * 60 * 1000, // 10 分鐘後清除快取
    enabled: !!channelId, // 只有在有 channelId 時才執行查詢
  });
}

/**
 * 取得單一頻道統計（用於需要單獨載入的場景）
 */
export function useChannelStats(channelId: string, days = 30) {
  return useQuery<ViewerChannelStats | null, Error>({
    queryKey: ["viewer", "channel-stats", channelId, days],
    queryFn: () => viewerApi.getChannelStats(channelId, days),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    enabled: !!channelId,
  });
}
