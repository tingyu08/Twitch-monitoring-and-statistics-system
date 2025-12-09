import { httpClient } from './httpClient';

/**
 * 開台統計總覽資料
 */
export interface StreamerSummary {
  range: '7d' | '30d' | '90d';
  totalStreamHours: number;
  totalStreamSessions: number;
  avgStreamDurationMinutes: number;
  isEstimated: boolean;
}

/**
 * 取得實況主在指定期間的開台統計總覽
 * @param range - 時間範圍 ('7d' | '30d' | '90d')
 * @returns 開台統計總覽
 */
export async function getStreamerSummary(
  range: '7d' | '30d' | '90d' = '30d'
): Promise<StreamerSummary> {
  return httpClient<StreamerSummary>(`/api/streamer/me/summary?range=${range}`);
}
