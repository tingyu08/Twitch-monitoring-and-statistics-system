import type { ViewerChannelLifetimeStats } from "@prisma/client";

export interface Badge {
  id: string;
  name: string;
  category: "watch-time" | "interaction" | "loyalty" | "streak";
  unlockedAt?: Date;
  progress: number; // 0-100
  icon?: string;
  description?: string;
}

interface BadgeDefinition {
  id: string;
  name: string;
  category: "watch-time" | "interaction" | "loyalty" | "streak";
  thresholdMinutes?: number;
  thresholdMessages?: number;
  thresholdDays?: number;
  thresholdStreak?: number;
}

export class BadgeService {
  // 定義徽章規則
  private readonly BADGES: BadgeDefinition[] = [
    // 觀看時數 (Minutes)
    {
      id: "newcomer",
      name: "新人觀眾",
      category: "watch-time",
      thresholdMinutes: 10 * 60,
    },
    {
      id: "loyal-viewer",
      name: "忠實觀眾",
      category: "watch-time",
      thresholdMinutes: 50 * 60,
    },
    {
      id: "veteran-fan",
      name: "資深粉絲",
      category: "watch-time",
      thresholdMinutes: 100 * 60,
    },
    {
      id: "iron-fan",
      name: "鐵粉",
      category: "watch-time",
      thresholdMinutes: 500 * 60,
    },
    {
      id: "legendary",
      name: "傳奇支持者",
      category: "watch-time",
      thresholdMinutes: 1000 * 60,
    }, // AC says > 500, I'll use 1000 for legendary or stick to AC.
    // AC: 100-500 is Iron, >500 is Legendary. So threshold 500*60 for Legendary.

    // 留言活躍
    {
      id: "first-words",
      name: "初次發言",
      category: "interaction",
      thresholdMessages: 1,
    },
    {
      id: "chatty",
      name: "話痨",
      category: "interaction",
      thresholdMessages: 100,
    },
    {
      id: "influencer",
      name: "意見領袖",
      category: "interaction",
      thresholdMessages: 500,
    },
    {
      id: "super-chatty",
      name: "超級話痨",
      category: "interaction",
      thresholdMessages: 1000,
    },

    // 忠誠度 (天數)
    {
      id: "new-follower",
      name: "新追蹤者",
      category: "loyalty",
      thresholdDays: 1,
    },
    {
      id: "long-term",
      name: "長期支持者",
      category: "loyalty",
      thresholdDays: 30,
    },
    { id: "og-fan", name: "元老粉絲", category: "loyalty", thresholdDays: 90 },
    { id: "die-hard", name: "老鐵", category: "loyalty", thresholdDays: 365 },

    // 連續簽到
    {
      id: "streak-7",
      name: "連續 7 天",
      category: "streak",
      thresholdStreak: 7,
    },
    {
      id: "streak-30",
      name: "連續 30 天",
      category: "streak",
      thresholdStreak: 30,
    },
    {
      id: "streak-90",
      name: "連續 90 天",
      category: "streak",
      thresholdStreak: 90,
    },
  ];

  public checkBadges(stats: ViewerChannelLifetimeStats): Badge[] {
    const badges: Badge[] = [];

    for (const def of this.BADGES) {
      let progress = 0;
      let unlocked = false;
      let currentValue = 0;
      let targetValue = 0;

      switch (def.category) {
        case "watch-time":
          currentValue = stats.totalWatchTimeMinutes;
          targetValue = def.thresholdMinutes || 0;
          break;
        case "interaction":
          currentValue = stats.totalMessages;
          targetValue = def.thresholdMessages || 0;
          break;
        case "loyalty":
          currentValue = stats.trackingDays;
          targetValue = def.thresholdDays || 0;
          break;
        case "streak":
          currentValue = stats.longestStreakDays;
          targetValue = def.thresholdStreak || 0;
          break;
      }

      if (targetValue === 0) {
        progress = currentValue > 0 ? 100 : 0;
      } else {
        progress = Math.min(100, Math.floor((currentValue / targetValue) * 100));
      }

      if (currentValue >= targetValue) {
        unlocked = true;
        progress = 100;
      }

      badges.push({
        id: def.id,
        name: def.name,
        category: def.category,
        progress,
        unlockedAt: unlocked ? stats.updatedAt : undefined,
      });
    }

    return badges;
  }
}

export const badgeService = new BadgeService();
