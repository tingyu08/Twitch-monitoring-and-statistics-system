import { getLifetimeStats, type LifetimeStatsResponse } from "../lifetime-stats";
import { httpClient } from "../httpClient";

jest.mock("../httpClient");

const mockHttpClient = httpClient as jest.MockedFunction<typeof httpClient>;

describe("lifetime-stats api", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fetches lifetime stats for a viewer and channel", async () => {
    const response: LifetimeStatsResponse = {
      channelId: "channel-1",
      channelName: "demo-channel",
      channelDisplayName: "Demo Channel",
      lifetimeStats: {
        watchTime: {
          totalMinutes: 600,
          totalHours: 10,
          avgSessionMinutes: 90,
          firstWatchedAt: "2025-01-01T00:00:00.000Z",
          lastWatchedAt: "2025-01-31T00:00:00.000Z",
        },
        messages: {
          totalMessages: 120,
          chatMessages: 100,
          subscriptions: 5,
          cheers: 3,
          totalBits: 250,
        },
        loyalty: {
          trackingDays: 40,
          longestStreakDays: 12,
          currentStreakDays: 4,
        },
        activity: {
          activeDaysLast30: 18,
          activeDaysLast90: 45,
          mostActiveMonth: "2025-01",
          mostActiveMonthCount: 60,
        },
        rankings: {
          watchTimePercentile: 90,
          messagePercentile: 80,
        },
      },
      badges: [
        {
          id: "badge-1",
          name: "Regular",
          category: "loyalty",
          unlockedAt: "2025-01-15T00:00:00.000Z",
          progress: 100,
        },
      ],
      radarScores: {
        watchTime: 82,
        interaction: 76,
        loyalty: 88,
        activity: 70,
        contribution: 64,
        community: 91,
      },
    };

    mockHttpClient.mockResolvedValueOnce(response);

    const result = await getLifetimeStats("viewer-1", "channel-1");

    expect(result).toEqual(response);
    expect(mockHttpClient).toHaveBeenCalledWith(
      "/api/viewer/viewer-1/channels/channel-1/lifetime-stats"
    );
  });

  it("propagates request failures", async () => {
    mockHttpClient.mockRejectedValueOnce(new Error("stats unavailable"));

    await expect(getLifetimeStats("viewer-2", "channel-9")).rejects.toThrow(
      "stats unavailable"
    );
  });
});
