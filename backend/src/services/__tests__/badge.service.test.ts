import { BadgeService } from "../badge.service";

describe("BadgeService", () => {
  let badgeService: BadgeService;

  beforeEach(() => {
    badgeService = new BadgeService();
  });

  const mockStats = {
    totalWatchTimeMinutes: 0,
    totalMessages: 0,
    trackingDays: 0,
    longestStreakDays: 0,
    updatedAt: new Date("2025-01-01"),
  };

  it("should return empty badges for zero stats", () => {
    const badges = badgeService.checkBadges(mockStats);
    expect(badges.filter((b) => b.progress > 0)).toHaveLength(0);
    expect(badges.every((b) => b.unlockedAt === undefined)).toBe(true);
  });

  it("should unlock 'newcomer' badge when watch time > 10m", () => {
    // Threshold is 10 * 60 minutes = 600 minutes
    const stats = { ...mockStats, totalWatchTimeMinutes: 650 };
    const badges = badgeService.checkBadges(stats);

    const badge = badges.find((b) => b.id === "newcomer");
    expect(badge).toBeDefined();
    expect(badge?.progress).toBe(100);
    expect(badge?.unlockedAt).toBeDefined();
  });

  it("should calculate progress correctly for incomplete badges", () => {
    // Threshold for 'loyal-viewer' is 50 * 60 = 3000 minutes
    // Current: 1500 minutes (50% progress)
    const stats = { ...mockStats, totalWatchTimeMinutes: 1500 };
    const badges = badgeService.checkBadges(stats);

    const badge = badges.find((b) => b.id === "loyal-viewer");
    expect(badge).toBeDefined();
    expect(badge?.progress).toBe(50);
    expect(badge?.unlockedAt).toBeUndefined();
  });

  it("should unlock 'first-words' badge after 1 message", () => {
    const stats = { ...mockStats, totalMessages: 5 };
    const badges = badgeService.checkBadges(stats);

    const badge = badges.find((b) => b.id === "first-words");
    expect(badge?.unlockedAt).toBeDefined();
  });

  it("should unlock 'new-follower' badge after 1 tracking day", () => {
    const stats = { ...mockStats, trackingDays: 2 };
    const badges = badgeService.checkBadges(stats);

    const badge = badges.find((b) => b.id === "new-follower");
    expect(badge?.unlockedAt).toBeDefined();
  });

  it("should unlock 'streak-7' badge after 7 streak days", () => {
    const stats = { ...mockStats, longestStreakDays: 8 };
    const badges = badgeService.checkBadges(stats);

    const badge = badges.find((b) => b.id === "streak-7");
    expect(badge?.unlockedAt).toBeDefined();
  });
});
