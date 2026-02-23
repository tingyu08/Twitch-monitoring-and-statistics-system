import { httpClient } from "./httpClient";
import type { VideoResponse, ClipResponse, GameStats as StreamerGameStats } from "./streamer";
export type GameStats = StreamerGameStats;

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

function toNumberOrFallback(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function toStringOrFallback(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function normalizeFollowedChannel(raw: unknown): FollowedChannel {
  const item = (raw || {}) as Record<string, unknown>;

  const id = toStringOrFallback(item.id, "");
  const channelName = toStringOrFallback(item.channelName, "");
  const displayName = toStringOrFallback(item.displayName, channelName || "Unknown");
  const avatarUrl = toStringOrFallback(item.avatarUrl, "");
  const category = toStringOrFallback(item.category, "Just Chatting");

  const totalWatchMinutes = toNumberOrFallback(
    item.totalWatchMinutes ?? item.totalWatchMin ?? item.totalWatchTimeMinutes,
    0
  );
  const messageCount = toNumberOrFallback(item.messageCount ?? item.totalMessages, 0);

  const viewerCountRaw = item.viewerCount ?? item.currentViewerCount;
  const viewerCount =
    viewerCountRaw === null || viewerCountRaw === undefined ? null : toNumberOrFallback(viewerCountRaw, 0);

  return {
    id,
    channelName,
    displayName,
    avatarUrl,
    category,
    isLive: Boolean(item.isLive),
    viewerCount,
    streamStartedAt: toOptionalString(item.streamStartedAt),
    followedAt: toOptionalString(item.followedAt),
    tags: Array.isArray(item.tags) ? (item.tags as string[]) : [],
    lastWatched: toOptionalString(item.lastWatched),
    totalWatchMinutes,
    messageCount,
    currentTitle: toOptionalString(item.currentTitle) || undefined,
    currentGameName: toOptionalString(item.currentGameName) || undefined,
    currentViewerCount:
      item.currentViewerCount === undefined || item.currentViewerCount === null
        ? undefined
        : toNumberOrFallback(item.currentViewerCount, 0),
    currentStreamStartedAt: toOptionalString(item.currentStreamStartedAt) || undefined,
  };
}

export function normalizeFollowedChannelsResponse(raw: unknown): FollowedChannel[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => normalizeFollowedChannel(item));
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

type ViewerChannelStatsBackendResponse = {
  dailyStats: RealViewerDailyStat[];
  timeRange?: { startDate: string; endDate: string; days: number };
  channel?: ChannelInfo | null;
  // Some endpoints may already include summary.
  summary?: Partial<ViewerChannelStats["summary"]>;
};

function buildViewerChannelSummary(
  dailyStats: RealViewerDailyStat[]
): ViewerChannelStats["summary"] {
  const totalWatchHours = dailyStats.reduce((sum, s) => sum + s.watchHours, 0);
  const totalMessages = dailyStats.reduce((sum, s) => sum + s.messageCount, 0);
  const totalEmotes = dailyStats.reduce((sum, s) => sum + s.emoteCount, 0);

  const sessionCount = dailyStats.filter((s) => s.watchHours > 0).length;

  const avgWatchMin =
    dailyStats.length > 0 ? Math.round((totalWatchHours * 60) / dailyStats.length) : 0;

  return {
    totalWatchHours: Math.round(totalWatchHours * 10) / 10,
    totalMessages,
    totalEmotes,
    sessionCount,
    averageWatchMinutesPerDay: avgWatchMin,
    firstWatchDate: dailyStats.length > 0 ? dailyStats[0].date : "",
    lastWatchDate: dailyStats.length > 0 ? dailyStats[dailyStats.length - 1].date : "",
  };
}

function normalizeViewerChannelStats(
  channelId: string,
  input: ViewerChannelStats | ViewerChannelStatsBackendResponse
): ViewerChannelStats {
  const dailyStats = Array.isArray(input.dailyStats) ? input.dailyStats : [];

  const receivedChannel = input.channel ?? undefined;
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

  const computedSummary = buildViewerChannelSummary(dailyStats);
  const rawSummary = input.summary;

  const summary: ViewerChannelStats["summary"] = rawSummary
    ? {
        totalWatchHours:
          typeof rawSummary.totalWatchHours === "number"
            ? rawSummary.totalWatchHours
            : computedSummary.totalWatchHours,
        totalMessages:
          typeof rawSummary.totalMessages === "number"
            ? rawSummary.totalMessages
            : computedSummary.totalMessages,
        totalEmotes:
          typeof rawSummary.totalEmotes === "number"
            ? rawSummary.totalEmotes
            : computedSummary.totalEmotes,
        sessionCount:
          typeof rawSummary.sessionCount === "number"
            ? rawSummary.sessionCount
            : computedSummary.sessionCount,
        averageWatchMinutesPerDay:
          typeof rawSummary.averageWatchMinutesPerDay === "number"
            ? rawSummary.averageWatchMinutesPerDay
            : computedSummary.averageWatchMinutesPerDay,
        firstWatchDate:
          typeof rawSummary.firstWatchDate === "string"
            ? rawSummary.firstWatchDate
            : computedSummary.firstWatchDate,
        lastWatchDate:
          typeof rawSummary.lastWatchDate === "string"
            ? rawSummary.lastWatchDate
            : computedSummary.lastWatchDate,
      }
    : computedSummary;

  return {
    channel: targetChannel,
    dailyStats,
    summary,
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
    const response = await httpClient<unknown>("/api/viewer/channels");
    return normalizeFollowedChannelsResponse(response);
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
    // 由 React Query 負責快取，避免多層快取造成直播狀態不同步
    return getFollowedChannels();
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

  /**
   * P0 BFF Endpoint: 一次取得詳細頁所有資料
   * 包含：channelStats + messageStats + gameStats + viewerTrends
   */
  async getChannelDetailAll(
    channelId: string,
    days = 30
  ): Promise<{
    channelStats: ViewerChannelStats | null;
    messageStats: ViewerMessageStatsResponse | null;
    gameStats: GameStats[] | null;
    viewerTrends: ViewerTrendPoint[] | null;
  } | null> {
    try {
      const response = await httpClient<{
        channelStats: ViewerChannelStats | ViewerChannelStatsBackendResponse | null;
        messageStats: ViewerMessageStatsResponse | null;
        gameStats: GameStats[] | null;
        viewerTrends: ViewerTrendPoint[] | null;
      }>(`/api/viewer/channel-detail/${channelId}?days=${days}`);

      const channelStats = response.channelStats
        ? normalizeViewerChannelStats(channelId, response.channelStats)
        : null;

      return {
        ...response,
        channelStats,
      };
    } catch (err) {
      console.warn("Failed to fetch channel detail", err);
      return null;
    }
  },
};
