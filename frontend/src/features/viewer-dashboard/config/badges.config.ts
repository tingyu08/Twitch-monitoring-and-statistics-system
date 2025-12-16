// 徽章配置檔
export const BADGE_CONFIG: Record<
  string,
  { name: string; description: string; icon: string; color: string }
> = {
  // 觀看時數
  newcomer: {
    name: "新人觀眾",
    description: "累積觀看未滿 10 小時",
    icon: "🎬",
    color: "text-gray-400",
  },
  "loyal-viewer": {
    name: "忠實觀眾",
    description: "累積觀看 10 小時",
    icon: "⭐",
    color: "text-blue-400",
  },
  "veteran-fan": {
    name: "資深粉絲",
    description: "累積觀看 50 小時",
    icon: "🌟",
    color: "text-purple-400",
  },
  "iron-fan": {
    name: "鐵粉",
    description: "累積觀看 100 小時",
    icon: "💎",
    color: "text-pink-400",
  },
  legendary: {
    name: "傳奇支持者",
    description: "累積觀看 500 小時",
    icon: "👑",
    color: "text-yellow-400",
  },

  // 留言活躍
  "first-words": {
    name: "初次發言",
    description: "發送第 1 則留言",
    icon: "💬",
    color: "text-green-400",
  },
  chatty: {
    name: "話痨",
    description: "發送 100 則留言",
    icon: "🗣️",
    color: "text-cyan-400",
  },
  influencer: {
    name: "意見領袖",
    description: "發送 500 則留言",
    icon: "📢",
    color: "text-orange-400",
  },
  "super-chatty": {
    name: "超級話痨",
    description: "發送 1000 則留言",
    icon: "🎤",
    color: "text-red-400",
  },

  // 忠誠度
  "new-follower": {
    name: "新追蹤者",
    description: "剛開始追蹤",
    icon: "📅",
    color: "text-gray-300",
  },
  "long-term": {
    name: "長期支持者",
    description: "追蹤滿 1 個月",
    icon: "🔖",
    color: "text-indigo-400",
  },
  "og-fan": {
    name: "元老粉絲",
    description: "追蹤滿 3 個月",
    icon: "🏅",
    color: "text-yellow-500",
  },
  "die-hard": {
    name: "老鐵",
    description: "追蹤滿 1 年",
    icon: "🦅",
    color: "text-red-500",
  },

  // 連續簽到
  "streak-7": {
    name: "連續 7 天",
    description: "連續觀看 7 天",
    icon: "🔥",
    color: "text-orange-500",
  },
  "streak-30": {
    name: "連續 30 天",
    description: "連續觀看 30 天",
    icon: "⚡",
    color: "text-yellow-300",
  },
  "streak-90": {
    name: "連續 90 天",
    description: "連續觀看 90 天",
    icon: "🌈",
    color: "text-pink-500",
  },
};
