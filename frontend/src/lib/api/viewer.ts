import { httpClient } from "./httpClient";

export interface ViewerConsentResponse {
  viewerId: string;
  consentedAt: string;
  consentVersion: number;
}

export interface MockChannel {
  id: string;
  name: string;
  displayName: string;
  avatarUrl: string;
  isLive: boolean;
  totalWatchHours: number;
  totalMessages: number;
  lastWatched: string;
}

export interface MockDailyStat {
  date: string;
  watchMinutes: number;
  messageCount: number;
  emoteCount: number;
}

export interface MockChannelStats {
  channel: MockChannel;
  dailyStats: MockDailyStat[];
  summary: {
    totalWatchHours: number;
    totalMessages: number;
    totalEmotes: number;
    averageWatchMinutesPerDay: number;
    firstWatchDate: string;
    lastWatchDate: string;
  };
}

// Mock 頻道資料
const MOCK_CHANNELS: MockChannel[] = [
  {
    id: "ch_1",
    name: "shroud",
    displayName: "shroud",
    avatarUrl: "https://ui-avatars.com/api/?name=Shroud&background=random",
    isLive: true,
    totalWatchHours: 156.5,
    totalMessages: 423,
    lastWatched: "2025-12-11",
  },
  {
    id: "ch_2",
    name: "pokimane",
    displayName: "pokimane",
    avatarUrl: "https://ui-avatars.com/api/?name=Pokimane&background=random",
    isLive: false,
    totalWatchHours: 89.2,
    totalMessages: 156,
    lastWatched: "2025-12-10",
  },
  {
    id: "ch_3",
    name: "xqcow",
    displayName: "xQc",
    avatarUrl: "https://ui-avatars.com/api/?name=xQc&background=random",
    isLive: true,
    totalWatchHours: 234.8,
    totalMessages: 892,
    lastWatched: "2025-12-11",
  },
  {
    id: "ch_4",
    name: "lilypichu",
    displayName: "LilyPichu",
    avatarUrl: "https://ui-avatars.com/api/?name=LilyPichu&background=random",
    isLive: false,
    totalWatchHours: 45.3,
    totalMessages: 78,
    lastWatched: "2025-12-08",
  },
  {
    id: "ch_5",
    name: "disguisedtoast",
    displayName: "DisguisedToast",
    avatarUrl:
      "https://ui-avatars.com/api/?name=DisguisedToast&background=random",
    isLive: false,
    totalWatchHours: 67.1,
    totalMessages: 234,
    lastWatched: "2025-12-09",
  },
];

// 生成 Mock 每日統計
function generateMockDailyStats(days: number): MockDailyStat[] {
  const stats: MockDailyStat[] = [];
  const today = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    stats.push({
      date: date.toISOString().split("T")[0],
      watchMinutes: Math.floor(Math.random() * 180) + 30,
      messageCount: Math.floor(Math.random() * 50),
      emoteCount: Math.floor(Math.random() * 30),
    });
  }

  return stats;
}

// [Story 2.2] 真實 API
export interface FollowedChannel {
  id: string;
  channelName: string; // Twitch Username
  displayName: string; // Twitch Display Name
  avatarUrl: string;
  category: string;
  isLive: boolean;
  tags: string[];
  lastWatched: string | null;
  totalWatchMinutes: number;
  messageCount: number;
}

export async function getFollowedChannels(): Promise<FollowedChannel[]> {
  try {
    // 呼叫真實後端 API
    return await httpClient<FollowedChannel[]>("/api/viewer/channels");
  } catch (error) {
    console.warn(
      "Failed to fetch followed channels, returning empty list",
      error
    );
    return [];
  }
}

export interface RealViewerDailyStat {
  date: string;
  watchHours: number;
  messageCount: number;
  emoteCount: number;
}

export interface ViewerChannelStats {
  channel: MockChannel;
  dailyStats: RealViewerDailyStat[];
  summary: {
    totalWatchHours: number;
    totalMessages: number;
    totalEmotes: number;
    sessionCount: number; // 觀看次數
    averageWatchMinutesPerDay: number;
    firstWatchDate: string;
    lastWatchDate: string;
  };
}

// ... (MOCK_CHANNELS 保持不變) ...

// ... (interfaces above)

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

export const viewerApi = {
  // ... (previous methods)
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

  async searchChannels(query: string): Promise<MockChannel[]> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const lowerQuery = query.toLowerCase();
    return MOCK_CHANNELS.filter(
      (ch) =>
        ch.name.toLowerCase().includes(lowerQuery) ||
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
    // (existing implementation)
    // 1. 取得頻道基本資訊 (目前仍使用 Mock)
    await new Promise((resolve) => setTimeout(resolve, 300));
    const channel =
      MOCK_CHANNELS.find((ch) => ch.id === channelId) || MOCK_CHANNELS[0];

    const targetChannel = channel || {
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
        timeRange: any;
      }>(`/api/viewer/stats/${channelId}?days=${days}`);

      if (response && Array.isArray(response.dailyStats)) {
        dailyStats = response.dailyStats;
      } else if (Array.isArray(response)) {
        dailyStats = response;
      }
    } catch (err) {
      console.warn("Failed to fetch real stats, falling back to empty", err);
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

      // 注意：根據後端路由定義，這裡需要包含 viewerId，雖然主要校驗是靠 Token
      return await httpClient<ViewerMessageStatsResponse>(
        `/api/viewer/${viewerId}/channels/${channelId}/message-stats${queryString}`
      );
    } catch (err) {
      console.warn("Failed to fetch message stats", err);
      return null;
    }
  },

  // ============ Privacy Control APIs ============

  /**
   * 獲取隱私設定
   */
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

  /**
   * 更新隱私設定（暫停/恢復收集）
   */
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

  /**
   * 獲取資料統計摘要
   */
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

  /**
   * 清除所有訊息資料
   */
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

  /**
   * 清除特定頻道的訊息資料
   */
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
};
