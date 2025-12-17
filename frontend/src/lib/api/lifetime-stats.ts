import { httpClient } from "./httpClient";

export interface Badge {
  id: string;
  name: string;
  category: "watch-time" | "interaction" | "loyalty" | "streak";
  unlockedAt?: string;
  progress: number;
}

export interface LifetimeStatsResponse {
  channelId: string;
  channelName: string;
  channelDisplayName?: string;
  lifetimeStats: {
    watchTime: {
      totalMinutes: number;
      totalHours: number;
      avgSessionMinutes: number;
      firstWatchedAt: string | null;
      lastWatchedAt: string | null;
    };
    messages: {
      totalMessages: number;
      chatMessages: number;
      subscriptions: number;
      cheers: number;
      totalBits: number;
    };
    loyalty: {
      trackingDays: number;
      longestStreakDays: number;
      currentStreakDays: number;
    };
    activity: {
      activeDaysLast30: number;
      activeDaysLast90: number;
      mostActiveMonth: string | null;
      mostActiveMonthCount: number;
    };
    rankings: {
      watchTimePercentile: number;
      messagePercentile: number;
    };
  };
  badges: Badge[];
  radarScores: {
    watchTime: number;
    interaction: number;
    loyalty: number;
    activity: number;
    contribution: number;
    community: number;
  };
}

export const getLifetimeStats = async (
  viewerId: string,
  channelId: string
): Promise<LifetimeStatsResponse> => {
  const data = await httpClient<LifetimeStatsResponse>(
    `/api/viewer/${viewerId}/channels/${channelId}/lifetime-stats`
  );
  return data;
};
