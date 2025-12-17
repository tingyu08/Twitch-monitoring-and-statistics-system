import { calculateRadarScores } from "../radar-score-calculator";

describe("Radar Score Calculator", () => {
  const mockStats = {
    totalWatchTimeMinutes: 0,
    totalMessages: 0,
    trackingDays: 0,
    activeDaysLast30: 0,
    totalBits: 0,
    totalSubscriptions: 0,
  };

  it("should return 0 for empty stats", () => {
    const scores = calculateRadarScores(mockStats);
    expect(scores).toEqual({
      watchTime: 0,
      interaction: 0,
      loyalty: 0,
      activity: 0,
      contribution: 0,
      community: 0,
    });
  });

  it("should calculate max scores correctly", () => {
    const maxStats = {
      totalWatchTimeMinutes: 500 * 60, // 500 hours
      totalMessages: 2000,
      trackingDays: 365,
      activeDaysLast30: 30,
      totalBits: 10000,
      totalSubscriptions: 12,
    };

    const scores = calculateRadarScores(maxStats);
    expect(scores).toEqual({
      watchTime: 100,
      interaction: 100,
      loyalty: 100,
      activity: 100,
      contribution: 100,
      community: 100,
    });
  });

  it("should cap scores at 100", () => {
    const overflowStats = {
      totalWatchTimeMinutes: 1000 * 60,
      totalMessages: 4000,
      trackingDays: 400,
      activeDaysLast30: 31,
      totalBits: 20000,
      totalSubscriptions: 24,
    };

    const scores = calculateRadarScores(overflowStats);
    expect(scores).toEqual({
      watchTime: 100,
      interaction: 100,
      loyalty: 100,
      activity: 100,
      contribution: 100,
      community: 100,
    });
  });

  it("should calculate partial scores correctly", () => {
    const partialStats = {
      totalWatchTimeMinutes: 250 * 60, // 50%
      totalMessages: 1000, // 50%
      trackingDays: 182, // ~50%
      activeDaysLast30: 15, // 50%
      totalBits: 5000, // 50%
      totalSubscriptions: 6, // 50%
    };

    const scores = calculateRadarScores(partialStats);
    expect(scores.watchTime).toBe(50);
    expect(scores.interaction).toBe(50);
    expect(scores.activity).toBe(50);
    expect(scores.contribution).toBe(50);
    expect(scores.community).toBe(50);
    // Loyalty 182/365 * 100 = 49.86 -> 50
    expect(scores.loyalty).toBeCloseTo(50, 0);
  });
});
