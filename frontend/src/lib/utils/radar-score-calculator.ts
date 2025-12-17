export const calculateRadarScores = (stats: any) => {
  // 1. 觀看時長（滿分 500 小時）
  // 避免 totalWatchTimeMinutes 為 undefined
  const watchTimeMinutes = stats.totalWatchTimeMinutes || 0;
  const watchTimeScore = Math.min(100, (watchTimeMinutes / 60 / 500) * 100);

  // 2. 互動頻率（滿分 2000 則留言）
  const totalMessages = stats.totalMessages || 0;
  const interactionScore = Math.min(100, (totalMessages / 2000) * 100);

  // 3. 忠誠度（滿分 365 天）
  const trackingDays = stats.trackingDays || 0;
  const loyaltyScore = Math.min(100, (trackingDays / 365) * 100);

  // 4. 活躍度（最近 30 天活躍天數 / 30）
  const activeDaysLast30 = stats.activeDaysLast30 || 0;
  const activityScore = Math.min(100, (activeDaysLast30 / 30) * 100);

  // 5. 贊助貢獻（滿分 10000 Bits）
  const totalBits = stats.totalBits || 0;
  const contributionScore = Math.min(100, (totalBits / 10000) * 100);

  // 6. 社群參與（訂閱次數? AC says months/12, we have totalSubscriptions）
  const totalSubscriptions = stats.totalSubscriptions || 0;
  const communityScore = Math.min(100, (totalSubscriptions / 12) * 100);

  return {
    watchTime: Math.round(watchTimeScore),
    interaction: Math.round(interactionScore),
    loyalty: Math.round(loyaltyScore),
    activity: Math.round(activityScore),
    contribution: Math.round(contributionScore),
    community: Math.round(communityScore),
  };
};
