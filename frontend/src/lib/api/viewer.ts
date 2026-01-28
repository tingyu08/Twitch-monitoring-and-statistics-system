import { httpClient } from "./httpClient";
import type { VideoResponse, ClipResponse, GameStats } from "./streamer";

export interface ViewerTrendPoint {
  date: string;
  title: string;
  avgViewers: number;
  peakViewers: number;
  durationHours: number;
  category: string;
}

export interface HourlyViewerStat {
  timestamp: string;
  viewers: number;
}

export interface ViewerConsentResponse {
  viewerId: string;
  consentedAt: string;
  consentVersion: number;
}

// ========== Real API Interfaces ==========

export interface FollowedChannel {
  id: string;
  channelName: string; // Twitch Username
  displayName: string; // Twitch Display Name
  avatarUrl: string;
  category: string;
  isLive: boolean;
  viewerCount: number | null; // 觀眾人數（開台時才有）
  streamStartedAt: string | null; // 開台時間 ISO string（開台時才有）
  followedAt: string | null; // 追蹤時間 ISO string
  tags: string[];
  lastWatched: string | null;
  totalWatchMinutes: number;
  messageCount: number;
  // Real-time update fields (for WebSocket)
  currentTitle?: string;
  currentGameName?: string;
  currentViewerCount?: number;
  currentStreamStartedAt?: string;
}

export interface RealViewerDailyStat {
  date: string;
  watchHours: number;
  messageCount: number;
  emoteCount: number;
}

// Channel info type used in stats
export interface ChannelInfo {
  id: string;
  name: string;
  displayName: string;
  avatarUrl: string;
  isLive: boolean;
  totalWatchHours: number;
  totalMessages: number;
  lastWatched: string;
}

export interface ViewerChannelStats {
  channel: ChannelInfo;
  dailyStats: RealViewerDailyStat[];
  summary: {
    totalWatchHours: number;
    totalMessages: number;
    totalEmotes: number;
    sessionCount: number;
    averageWatchMinutesPerDay: number;
    firstWatchDate: string;
    lastWatchDate: string;
  };
}

export interface InteractionBreakdown {
  chatMessages: number;
  subscriptions: number;
  cheers: number;
  giftSubs: number;
  raids: number;
  totalBits: number;
}

export interface MessageStatsSummary {
  totalMessages: number;
  avgMessagesPerStream: number;
  mostActiveDate: string | null;
  mostActiveDateCount: number;
  lastMessageAt: string | null;
}

export interface MessageDailyStat {
  date: string;
  totalMessages: number;
  chatMessages: number;
  subscriptions: number;
  cheers: number;
}

export interface ViewerMessageStatsResponse {
  channelId: string;
  timeRange: {
    startDate: string;
    endDate: string;
  };
  summary: MessageStatsSummary;
  interactionBreakdown: InteractionBreakdown;
  dailyBreakdown: MessageDailyStat[];
}

// ========== API Functions ==========

export async function getFollowedChannels(): Promise<FollowedChannel[]> {
  try {
    return await httpClient<FollowedChannel[]>("/api/viewer/channels");
  } catch (error) {
    console.warn("Failed to fetch followed channels, returning empty list", error);
    return [];
  }
}

export const viewerApi = {
  async submitConsent(consented: boolean, consentVersion = 1): Promise<ViewerConsentResponse> {
    return httpClient<ViewerConsentResponse>("/api/viewer/consent", {
      method: "POST",
      body: JSON.stringify({ consented, consentVersion }),
    });
  },

  async getFollowedChannels(): Promise<FollowedChannel[]> {
    // P1 Opt: 加入簡單快取以避免重複請求轟炸 Turso
    const CACHE_KEY = "viewer_followed_channels";
    const CACHE_TTL = 30000; // 30 seconds

    // 檢查快取
    if (typeof window !== "undefined") {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        try {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_TTL) {
            return data;
          }
        } catch (e) {
          sessionStorage.removeItem(CACHE_KEY);
        }
      }
    }

    const channels = await getFollowedChannels();

    // 寫入快取
    if (typeof window !== "undefined" && channels.length > 0) {
      sessionStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          data: channels,
          timestamp: Date.now(),
        })
      );
    }

    return channels;
  },

  async searchChannels(query: string): Promise<FollowedChannel[]> {
    // Search from followed channels (real data)
    const channels = await getFollowedChannels();
    const lowerQuery = query.toLowerCase();
    return channels.filter(
      (ch) =>
        ch.channelName.toLowerCase().includes(lowerQuery) ||
        ch.displayName.toLowerCase().includes(lowerQuery)
    );
  },

  /**
   * 取得特定頻道的統計資料
   */
  async getChannelStats(channelId: string, days = 30): Promise<ViewerChannelStats | null> {
    let dailyStats: RealViewerDailyStat[] = [];
    let receivedChannel: ChannelInfo | undefined;
    let fallbackInfo: Partial<ChannelInfo> | undefined;

    try {
      // P1 Perf: 直接查詢後端，後端現在會回傳 channel 資訊，無需先拉取 getFollowedChannels
      const response = await httpClient<{
        dailyStats: RealViewerDailyStat[];
        timeRange: { startDate: string; endDate: string; days: number };
        channel?: ChannelInfo;
      }>(`/api/viewer/stats/${channelId}?days=${days}`);

      if (response) {
        if (Array.isArray(response.dailyStats)) {
          dailyStats = response.dailyStats;
        }
        if (response.channel) {
          receivedChannel = response.channel;
        }
      }
    } catch (err) {
      console.warn("Failed to fetch real stats", err);
      // 如果失敗，我們可能需要 fallback，但這通常意味著後端掛了
    }

    // 計算統計摘要
    const totalWatchHours = dailyStats.reduce((sum, s) => sum + s.watchHours, 0);
    const totalMessages = dailyStats.reduce((sum, s) => sum + s.messageCount, 0);
    const totalEmotes = dailyStats.reduce((sum, s) => sum + s.emoteCount, 0);

    const sessionCount = dailyStats.filter((s) => s.watchHours > 0).length;

    const avgWatchMin =
      dailyStats.length > 0 ? Math.round((totalWatchHours * 60) / dailyStats.length) : 0;

    // 構建 Channel Info (優先使用後端回傳的，否則構建基本物件)
    const targetChannel: ChannelInfo = receivedChannel || {
      id: channelId,
      name: "unknown",
      displayName: "Loading...",
      avatarUrl: "",
      isLive: false,
      totalWatchHours: 0,
      totalMessages: 0,
      lastWatched: "",
    };

    return {
      channel: targetChannel,
      dailyStats,
      summary: {
        totalWatchHours: Math.round(totalWatchHours * 10) / 10,
        totalMessages,
        totalEmotes,
        sessionCount,
        averageWatchMinutesPerDay: avgWatchMin,
        firstWatchDate: dailyStats.length > 0 ? dailyStats[0].date : "",
        lastWatchDate: dailyStats.length > 0 ? dailyStats[dailyStats.length - 1].date : "",
      },
    };
  },

  /**
   * 取得頻道的留言互動統計
   */
  async getMessageStats(
    viewerId: string,
    channelId: string,
    startDate?: string,
    endDate?: string
  ): Promise<ViewerMessageStatsResponse | null> {
    try {
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);

      const queryString = params.toString() ? `?${params.toString()}` : "";

      return await httpClient<ViewerMessageStatsResponse>(
        `/api/viewer/${viewerId}/channels/${channelId}/message-stats${queryString}`
      );
    } catch (err) {
      console.warn("Failed to fetch message stats", err);
      return null;
    }
  },

  // ============ Privacy Control APIs ============

  async getPrivacySettings(): Promise<{
    pauseCollection: boolean;
    consentGivenAt: string | null;
  } | null> {
    try {
      return await httpClient<{
        pauseCollection: boolean;
        consentGivenAt: string | null;
      }>("/api/viewer/privacy/settings");
    } catch (err) {
      console.warn("Failed to fetch privacy settings", err);
      return null;
    }
  },

  async updatePrivacySettings(pauseCollection: boolean): Promise<{
    success: boolean;
    message: string;
  } | null> {
    try {
      return await httpClient<{ success: boolean; message: string }>(
        "/api/viewer/privacy/settings",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pauseCollection }),
        }
      );
    } catch (err) {
      console.warn("Failed to update privacy settings", err);
      return null;
    }
  },

  async getDataSummary(): Promise<{
    totalMessages: number;
    totalAggregations: number;
    channelCount: number;
    dateRange: {
      oldest: string | null;
      newest: string | null;
    };
  } | null> {
    try {
      return await httpClient<{
        totalMessages: number;
        totalAggregations: number;
        channelCount: number;
        dateRange: {
          oldest: string | null;
          newest: string | null;
        };
      }>("/api/viewer/privacy/data-summary");
    } catch (err) {
      console.warn("Failed to fetch data summary", err);
      return null;
    }
  },

  async clearAllMessages(): Promise<{
    success: boolean;
    message: string;
    deletedCount: { messages: number; aggregations: number };
  } | null> {
    try {
      return await httpClient<{
        success: boolean;
        message: string;
        deletedCount: { messages: number; aggregations: number };
      }>("/api/viewer/privacy/messages", {
        method: "DELETE",
      });
    } catch (err) {
      console.warn("Failed to clear messages", err);
      return null;
    }
  },

  async clearChannelMessages(channelId: string): Promise<{
    success: boolean;
    message: string;
    deletedCount: { messages: number; aggregations: number };
  } | null> {
    try {
      return await httpClient<{
        success: boolean;
        message: string;
        deletedCount: { messages: number; aggregations: number };
      }>(`/api/viewer/privacy/messages/${channelId}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.warn("Failed to clear channel messages", err);
      return null;
    }
  },

  async setListenChannels(channels: Array<{ channelName: string; isLive: boolean }>): Promise<{
    success: boolean;
    message: string;
    listening: string[];
  } | null> {
    try {
      return await httpClient<{
        success: boolean;
        message: string;
        listening: string[];
      }>("/api/viewer/listen-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels }),
      });
    } catch (err) {
      console.warn("Failed to set listen channels", err);
      return null;
    }
  },

  /**
   * 取得頻道的 VOD 列表 (公開)
   */
  async getChannelVideos(channelId: string, page = 1, limit = 6): Promise<VideoResponse | null> {
    try {
      return await httpClient<VideoResponse>(
        `/api/streamer/${channelId}/videos?page=${page}&limit=${limit}`
      );
    } catch (err) {
      console.warn("Failed to fetch videos", err);
      return null;
    }
  },

  /**
   * 取得頻道的 Clip 列表 (公開)
   */
  async getChannelClips(channelId: string, page = 1, limit = 6): Promise<ClipResponse | null> {
    try {
      return await httpClient<ClipResponse>(
        `/api/streamer/${channelId}/clips?page=${page}&limit=${limit}`
      );
    } catch (err) {
      console.warn("Failed to fetch clips", err);
      return null;
    }
  },

  /**
   * 取得頻道的遊戲統計 (公開)
   */
  async getChannelGameStats(channelId: string, range = "30d"): Promise<GameStats[] | null> {
    try {
      return await httpClient<GameStats[]>(`/api/streamer/${channelId}/game-stats?range=${range}`);
    } catch (err) {
      console.warn("Failed to fetch game stats", err);
      return null;
    }
  },

  /**
   * 取得頻道的觀眾人數趨勢 (公開)
   */
  async getChannelViewerTrends(
    channelId: string,
    range = "30d"
  ): Promise<ViewerTrendPoint[] | null> {
    try {
      return await httpClient<ViewerTrendPoint[]>(
        `/api/streamer/${channelId}/viewer-trends?range=${range}`
      );
    } catch (err) {
      console.warn("Failed to fetch viewer trends", err);
      return null;
    }
  },

  /**
   * 取得特定直播的小時觀眾分佈 (公開)
   */
  async getChannelStreamHourlyStats(
    channelId: string,
    date: string
  ): Promise<HourlyViewerStat[] | null> {
    try {
      return await httpClient<HourlyViewerStat[]>(
        `/api/streamer/${channelId}/stream-hourly?date=${date}`
      );
    } catch (err) {
      console.warn("Failed to fetch stream hourly stats", err);
      return null;
    }
  },
};
