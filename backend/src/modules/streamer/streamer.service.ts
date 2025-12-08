import { prisma } from '../../db/prisma';

export interface StreamerSummary {
  totalStreamHours: number;
  totalStreamSessions: number;
  avgStreamDurationMinutes: number;
  range: string; // '7d' | '30d' | '90d'
  isEstimated?: boolean;
}

/**
 * 取得實況主在指定期間的開台統計總覽
 * @param streamerId - 實況主 ID
 * @param range - 時間範圍 ('7d' | '30d' | '90d')
 * @returns 開台統計總覽
 */
export async function getStreamerSummary(
  streamerId: string,
  range: string = '30d'
): Promise<StreamerSummary> {
  // 1. 解析時間範圍
  const now = new Date();
  let days = 30;
  if (range === '7d') days = 7;
  if (range === '90d') days = 90;

  const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // 2. 取得實況主的頻道 ID
  const channel = await prisma.channel.findFirst({
    where: { streamerId },
  });

  if (!channel) {
    // 如果找不到頻道，回傳空統計
    return {
      range,
      totalStreamHours: 0,
      totalStreamSessions: 0,
      avgStreamDurationMinutes: 0,
      isEstimated: false,
    };
  }

  // 3. 查詢指定期間的開台紀錄
  const sessions = await prisma.streamSession.findMany({
    where: {
      channelId: channel.id,
      startedAt: {
        gte: cutoffDate,
      },
    },
    select: {
      durationSeconds: true,
    },
  });

  // 4. 計算統計數據
  const totalStreamSessions = sessions.length;
  const totalSeconds = sessions.reduce((sum, s) => sum + (s.durationSeconds || 0), 0);
  const totalStreamHours = Math.round((totalSeconds / 3600) * 10) / 10; // 取小數點後一位
  const avgStreamDurationMinutes =
    totalStreamSessions > 0
      ? Math.round(totalSeconds / 60 / totalStreamSessions)
      : 0;

  return {
    range,
    totalStreamHours,
    totalStreamSessions,
    avgStreamDurationMinutes,
    isEstimated: false,
  };
}