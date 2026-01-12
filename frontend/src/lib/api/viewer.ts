import { httpClient } from "./httpClient";
import type { VideoResponse, ClipResponse, GameStats } from "./streamer";

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
    console.warn(
      "Failed to fetch followed channels, returning empty list",
      error
    );
    return [];
  }
}

export const viewerApi = {
  async submitConsent(
    consented: boolean,
    consentVersion = 1
  ): Promise<ViewerConsentResponse> {
    return httpClient<ViewerConsentResponse>("/api/viewer/consent", {
      method: "POST",
      body: JSON.stringify({ consented, consentVersion }),
    });
  },

  async getFollowedChannels(): Promise<FollowedChannel[]> {
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
  async getChannelStats(
    channelId: string,
    days = 30
  ): Promise<ViewerChannelStats | null> {
    // 1. 從追蹤清單中獲取真實頻道資訊
    const followedChannels = await getFollowedChannels();
    const realChannel = followedChannels.find((ch) => ch.id === channelId);

    const targetChannel: ChannelInfo = realChannel
      ? {
          id: realChannel.id,
          name: realChannel.channelName,
          displayName: realChannel.displayName,
          avatarUrl: realChannel.avatarUrl,
          isLive: realChannel.isLive,
          totalWatchHours: Math.round(realChannel.totalWatchMinutes / 60),
          totalMessages: realChannel.messageCount,
          lastWatched: realChannel.lastWatched || "",
        }
      : {
          id: channelId,
          name: "unknown",
          displayName: "Unknown Channel",
          avatarUrl: "",
          isLive: false,
          totalWatchHours: 0,
          totalMessages: 0,
          lastWatched: "",
        };

    let dailyStats: RealViewerDailyStat[] = [];
    try {
      const response = await httpClient<{
        dailyStats: RealViewerDailyStat[];
        timeRange: { startDate: string; endDate: string; days: number };
      }>(`/api/viewer/stats/${channelId}?days=${days}`);

      if (response && Array.isArray(response.dailyStats)) {
        dailyStats = response.dailyStats;
      } else if (Array.isArray(response)) {
        dailyStats = response as RealViewerDailyStat[];
      }
    } catch (err) {
      console.warn("Failed to fetch real stats, returning empty", err);
    }

    const totalWatchHours = dailyStats.reduce(
      (sum, s) => sum + s.watchHours,
      0
    );
    const totalMessages = dailyStats.reduce(
      (sum, s) => sum + s.messageCount,
      0
    );
    const totalEmotes = dailyStats.reduce((sum, s) => sum + s.emoteCount, 0);

    const sessionCount = dailyStats.filter((s) => s.watchHours > 0).length;

    const avgWatchMin =
      dailyStats.length > 0
        ? Math.round((totalWatchHours * 60) / dailyStats.length)
        : 0;

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
        lastWatchDate:
          dailyStats.length > 0 ? dailyStats[dailyStats.length - 1].date : "",
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

  async setListenChannels(
    channels: Array<{ channelName: string; isLive: boolean }>
  ): Promise<{
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
  async getChannelVideos(
    channelId: string,
    page = 1,
    limit = 6
  ): Promise<VideoResponse | null> {
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
  async getChannelClips(
    channelId: string,
    page = 1,
    limit = 6
  ): Promise<ClipResponse | null> {
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
  async getChannelGameStats(
    channelId: string,
    range = "30d"
  ): Promise<GameStats[] | null> {
    try {
      return await httpClient<GameStats[]>(
        `/api/streamer/${channelId}/game-stats?range=${range}`
      );
    } catch (err) {
      console.warn("Failed to fetch game stats", err);
      return null;
    }
  },
};
