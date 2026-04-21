/**
 * 資料遷移腳本：Turso (SQLite) -> Supabase (PostgreSQL)
 *
 * 執行方式：
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... DATABASE_URL=... \
 *     npx ts-node --project tsconfig.json scripts/migrate-to-supabase.ts
 */

import "dotenv/config";
import { createClient, Client as TursoClient } from "@libsql/client";
import { prisma } from "../src/db/prisma";

// ────────────────────────────────────────────────────────────────────────────────
// 型別輔助
// ────────────────────────────────────────────────────────────────────────────────

function toBoolean(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  return v === 1 || v === "1" || v === "true";
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}

function toDateRequired(v: unknown, field: string): Date {
  const d = toDate(v);
  if (!d) throw new Error(`欄位 "${field}" 無法轉換為 Date: ${v}`);
  return d;
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : Math.round(n);
}

function toFloat(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

// ────────────────────────────────────────────────────────────────────────────────
// 通用遷移函數
// ────────────────────────────────────────────────────────────────────────────────

async function migrateTable<T extends object>(
  turso: TursoClient,
  tableName: string,
  batchSize: number,
  transform: (row: Record<string, unknown>) => T,
  prismaCreate: (data: T[]) => Promise<{ count: number }>,
): Promise<{ tableName: string; migrated: number; failed: boolean; error?: string }> {
  const countResult = await turso.execute(`SELECT COUNT(*) as total FROM "${tableName}"`);
  const total = Number(countResult.rows[0]?.[0] ?? 0);

  if (total === 0) {
    console.log(`[${tableName}] 無資料，跳過`);
    return { tableName, migrated: 0, failed: false };
  }

  console.log(`[${tableName}] 開始遷移，共 ${total} 筆`);

  let offset = 0;
  let totalMigrated = 0;

  while (offset < total) {
    const result = await turso.execute({
      sql: `SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`,
      args: [batchSize, offset],
    });

    if (result.rows.length === 0) break;

    const rows = result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      result.columns.forEach((col, idx) => {
        obj[col] = (row as unknown as unknown[])[idx];
      });
      return obj;
    });

    const transformed = rows.map((row) => transform(row));
    const { count } = await prismaCreate(transformed);
    totalMigrated += count;
    offset += result.rows.length;

    console.log(`[${tableName}] 已搬 ${Math.min(offset, total)} / ${total} 筆`);
  }

  return { tableName, migrated: totalMigrated, failed: false };
}

// ────────────────────────────────────────────────────────────────────────────────
// 各 Table 遷移（欄位名與 Prisma schema camelCase 一致）
// ────────────────────────────────────────────────────────────────────────────────

const migrate = {
  systemSettings: (turso: TursoClient) =>
    migrateTable(turso, "system_settings", 500,
      (r) => ({
        id: r.id as string,
        key: r.key as string,
        value: r.value as string,
        createdAt: toDateRequired(r.createdAt, "createdAt"),
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.systemSetting.createMany({ data, skipDuplicates: true }),
    ),

  streamers: (turso: TursoClient) =>
    migrateTable(turso, "streamers", 500,
      (r) => ({
        id: r.id as string,
        twitchUserId: r.twitchUserId as string,
        displayName: r.displayName as string,
        avatarUrl: toStr(r.avatarUrl),
        email: toStr(r.email),
        createdAt: toDateRequired(r.createdAt, "createdAt"),
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.streamer.createMany({ data, skipDuplicates: true }),
    ),

  viewers: (turso: TursoClient) =>
    migrateTable(turso, "viewers", 500,
      (r) => ({
        id: r.id as string,
        twitchUserId: r.twitchUserId as string,
        displayName: toStr(r.displayName),
        avatarUrl: toStr(r.avatarUrl),
        tokenVersion: toInt(r.tokenVersion) ?? 0,
        createdAt: toDateRequired(r.createdAt, "createdAt"),
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
        isAnonymized: toBoolean(r.isAnonymized),
        anonymizedAt: toDate(r.anonymizedAt),
        consentedAt: toDate(r.consentedAt),
        consentVersion: toInt(r.consentVersion),
        deletedAt: toDate(r.deletedAt),
      }),
      (data) => prisma.viewer.createMany({ data, skipDuplicates: true }),
    ),

  channels: (turso: TursoClient) =>
    migrateTable(turso, "channels", 500,
      (r) => ({
        id: r.id as string,
        streamerId: toStr(r.streamerId),
        twitchChannelId: r.twitchChannelId as string,
        channelName: r.channelName as string,
        channelUrl: toStr(r.channelUrl),
        isMonitored: toBoolean(r.isMonitored),
        isLive: toBoolean(r.isLive),
        currentViewerCount: toInt(r.currentViewerCount) ?? 0,
        currentStreamStartedAt: toDate(r.currentStreamStartedAt),
        currentGameName: toStr(r.currentGameName),
        currentTitle: toStr(r.currentTitle),
        lastLiveCheckAt: toDate(r.lastLiveCheckAt),
        source: toStr(r.source) ?? "platform",
        createdAt: toDateRequired(r.createdAt, "createdAt"),
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.channel.createMany({ data, skipDuplicates: true }),
    ),

  twitchTokens: (turso: TursoClient) =>
    migrateTable(turso, "twitch_tokens", 500,
      (r) => ({
        id: r.id as string,
        ownerType: r.ownerType as string,
        streamerId: toStr(r.streamerId),
        viewerId: toStr(r.viewerId),
        accessToken: r.accessToken as string,
        refreshToken: toStr(r.refreshToken),
        expiresAt: toDate(r.expiresAt),
        scopes: toStr(r.scopes) ?? "[]",
        status: toStr(r.status) ?? "active",
        lastValidatedAt: toDate(r.lastValidatedAt),
        failureCount: toInt(r.failureCount) ?? 0,
        createdAt: toDateRequired(r.createdAt, "createdAt"),
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.twitchToken.createMany({ data, skipDuplicates: true }),
    ),

  streamSessions: (turso: TursoClient) =>
    migrateTable(turso, "stream_sessions", 500,
      (r) => ({
        id: r.id as string,
        channelId: r.channelId as string,
        twitchStreamId: toStr(r.twitchStreamId),
        startedAt: toDateRequired(r.startedAt, "startedAt"),
        endedAt: toDate(r.endedAt),
        durationSeconds: toInt(r.durationSeconds),
        title: toStr(r.title),
        category: toStr(r.category),
        avgViewers: toInt(r.avgViewers),
        peakViewers: toInt(r.peakViewers),
        createdAt: toDateRequired(r.createdAt, "createdAt"),
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.streamSession.createMany({ data, skipDuplicates: true }),
    ),

  streamMetrics: (turso: TursoClient) =>
    migrateTable(turso, "stream_metrics", 500,
      (r) => ({
        id: r.id as string,
        streamSessionId: r.streamSessionId as string,
        timestamp: toDateRequired(r.timestamp, "timestamp"),
        viewerCount: toInt(r.viewerCount) ?? 0,
        chatCount: toInt(r.chatCount) ?? 0,
      }),
      (data) => prisma.streamMetric.createMany({ data, skipDuplicates: true }),
    ),

  channelDailyStats: (turso: TursoClient) =>
    migrateTable(turso, "channel_daily_stats", 500,
      (r) => ({
        id: r.id as string,
        channelId: r.channelId as string,
        date: toDateRequired(r.date, "date"),
        streamSeconds: toInt(r.streamSeconds) ?? 0,
        streamCount: toInt(r.streamCount) ?? 0,
        avgViewers: toInt(r.avgViewers),
        peakViewers: toInt(r.peakViewers),
        subsTotal: toInt(r.subsTotal),
        subsDelta: toInt(r.subsDelta),
        createdAt: toDateRequired(r.createdAt, "createdAt"),
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.channelDailyStat.createMany({ data, skipDuplicates: true }),
    ),

  listenerInstances: (turso: TursoClient) =>
    migrateTable(turso, "listener_instances", 500,
      (r) => ({
        id: r.id as string,
        instanceId: r.instanceId as string,
        channelCount: toInt(r.channelCount) ?? 0,
        lastHeartbeat: toDateRequired(r.lastHeartbeat, "lastHeartbeat"),
        startedAt: toDateRequired(r.startedAt, "startedAt"),
        createdAt: toDateRequired(r.createdAt, "createdAt"),
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.listenerInstance.createMany({ data, skipDuplicates: true }),
    ),

  channelListenerLocks: (turso: TursoClient) =>
    migrateTable(turso, "channel_listener_locks", 500,
      (r) => ({
        id: r.id as string,
        channelId: r.channelId as string,
        instanceId: r.instanceId as string,
        lastHeartbeat: toDateRequired(r.lastHeartbeat, "lastHeartbeat"),
        acquiredAt: toDateRequired(r.acquiredAt, "acquiredAt"),
        createdAt: toDateRequired(r.createdAt, "createdAt"),
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.channelListenerLock.createMany({ data, skipDuplicates: true }),
    ),

  userFollows: (turso: TursoClient) =>
    migrateTable(turso, "user_follows", 500,
      (r) => ({
        id: r.id as string,
        userId: r.userId as string,
        userType: r.userType as string,
        channelId: r.channelId as string,
        followedAt: toDateRequired(r.followedAt, "followedAt"),
        createdAt: toDateRequired(r.createdAt, "createdAt"),
      }),
      (data) => prisma.userFollow.createMany({ data, skipDuplicates: true }),
    ),

  viewerChannelDailyStats: (turso: TursoClient) =>
    migrateTable(turso, "viewer_channel_daily_stats", 500,
      (r) => ({
        id: r.id as string,
        viewerId: r.viewerId as string,
        channelId: r.channelId as string,
        date: toDateRequired(r.date, "date"),
        watchSeconds: toInt(r.watchSeconds) ?? 0,
        messageCount: toInt(r.messageCount) ?? 0,
        emoteCount: toInt(r.emoteCount) ?? 0,
        source: toStr(r.source) ?? "chat",
        createdAt: toDateRequired(r.createdAt, "createdAt"),
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.viewerChannelDailyStat.createMany({ data, skipDuplicates: true }),
    ),

  viewerChannelMessages: (turso: TursoClient) =>
    migrateTable(turso, "viewer_channel_messages", 500,
      (r) => ({
        id: r.id as string,
        messageDedupKey: r.messageDedupKey as string,
        viewerId: r.viewerId as string,
        channelId: r.channelId as string,
        messageText: r.messageText as string,
        messageType: r.messageType as string,
        timestamp: toDateRequired(r.timestamp, "timestamp"),
        badges: toStr(r.badges),
        emotesUsed: toStr(r.emotesUsed),
        bitsAmount: toInt(r.bitsAmount),
        createdAt: toDateRequired(r.createdAt, "createdAt"),
      }),
      (data) => prisma.viewerChannelMessage.createMany({ data, skipDuplicates: true }),
    ),

  extensionHeartbeatDedups: (turso: TursoClient) =>
    migrateTable(turso, "extension_heartbeat_dedups", 500,
      (r) => ({
        id: r.id as string,
        dedupKey: r.dedupKey as string,
        viewerId: r.viewerId as string,
        channelId: r.channelId as string,
        heartbeatTimestamp: toDateRequired(r.heartbeatTimestamp, "heartbeatTimestamp"),
        durationSeconds: toInt(r.durationSeconds) ?? 0,
        createdAt: toDateRequired(r.createdAt, "createdAt"),
      }),
      (data) => prisma.extensionHeartbeatDedup.createMany({ data, skipDuplicates: true }),
    ),

  viewerChannelMessageDailyAggs: (turso: TursoClient) =>
    migrateTable(turso, "viewer_channel_message_daily_aggs", 500,
      (r) => ({
        id: r.id as string,
        viewerId: r.viewerId as string,
        channelId: r.channelId as string,
        date: toDateRequired(r.date, "date"),
        totalMessages: toInt(r.totalMessages) ?? 0,
        chatMessages: toInt(r.chatMessages) ?? 0,
        subscriptions: toInt(r.subscriptions) ?? 0,
        cheers: toInt(r.cheers) ?? 0,
        giftSubs: toInt(r.giftSubs) ?? 0,
        raids: toInt(r.raids) ?? 0,
        totalBits: toInt(r.totalBits) ?? 0,
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.viewerChannelMessageDailyAgg.createMany({ data, skipDuplicates: true }),
    ),

  viewerChannelLifetimeStats: (turso: TursoClient) =>
    migrateTable(turso, "viewer_channel_lifetime_stats", 500,
      (r) => ({
        id: r.id as string,
        viewerId: r.viewerId as string,
        channelId: r.channelId as string,
        totalWatchTimeMinutes: toInt(r.totalWatchTimeMinutes) ?? 0,
        totalSessions: toInt(r.totalSessions) ?? 0,
        avgSessionMinutes: toInt(r.avgSessionMinutes) ?? 0,
        firstWatchedAt: toDate(r.firstWatchedAt),
        lastWatchedAt: toDate(r.lastWatchedAt),
        totalMessages: toInt(r.totalMessages) ?? 0,
        totalChatMessages: toInt(r.totalChatMessages) ?? 0,
        totalSubscriptions: toInt(r.totalSubscriptions) ?? 0,
        totalCheers: toInt(r.totalCheers) ?? 0,
        totalBits: toInt(r.totalBits) ?? 0,
        trackingStartedAt: toDateRequired(r.trackingStartedAt, "trackingStartedAt"),
        trackingDays: toInt(r.trackingDays) ?? 0,
        longestStreakDays: toInt(r.longestStreakDays) ?? 0,
        currentStreakDays: toInt(r.currentStreakDays) ?? 0,
        activeDaysLast30: toInt(r.activeDaysLast30) ?? 0,
        activeDaysLast90: toInt(r.activeDaysLast90) ?? 0,
        mostActiveMonth: toStr(r.mostActiveMonth),
        mostActiveMonthCount: toInt(r.mostActiveMonthCount) ?? 0,
        watchTimePercentile: toFloat(r.watchTimePercentile),
        messagePercentile: toFloat(r.messagePercentile),
        createdAt: toDateRequired(r.createdAt, "createdAt"),
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.viewerChannelLifetimeStats.createMany({ data, skipDuplicates: true }),
    ),

  viewerChannelSummaries: (turso: TursoClient) =>
    migrateTable(turso, "viewer_channel_summary", 500,
      (r) => ({
        viewerId: r.viewerId as string,
        channelId: r.channelId as string,
        channelName: r.channelName as string,
        displayName: r.displayName as string,
        avatarUrl: r.avatarUrl as string,
        category: toStr(r.category),
        isLive: toBoolean(r.isLive),
        viewerCount: toInt(r.viewerCount),
        streamStartedAt: toDate(r.streamStartedAt),
        lastWatched: toDate(r.lastWatched),
        totalWatchMin: toInt(r.totalWatchMin) ?? 0,
        messageCount: toInt(r.messageCount) ?? 0,
        isExternal: toBoolean(r.isExternal),
        followedAt: toDate(r.followedAt),
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.viewerChannelSummary.createMany({ data, skipDuplicates: true }),
    ),

  viewerDashboardLayouts: (turso: TursoClient) =>
    migrateTable(turso, "viewer_dashboard_layouts", 500,
      (r) => ({
        id: r.id as string,
        viewerId: r.viewerId as string,
        channelId: r.channelId as string,
        layout: r.layout as string,
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.viewerDashboardLayout.createMany({ data, skipDuplicates: true }),
    ),

  viewerPrivacyConsents: (turso: TursoClient) =>
    migrateTable(turso, "viewer_privacy_consents", 500,
      (r) => ({
        id: r.id as string,
        viewerId: r.viewerId as string,
        consentVersion: toStr(r.consentVersion) ?? "v1.0",
        consentGivenAt: toDateRequired(r.consentGivenAt, "consentGivenAt"),
        collectDailyWatchTime: toBoolean(r.collectDailyWatchTime),
        collectWatchTimeDistribution: toBoolean(r.collectWatchTimeDistribution),
        collectMonthlyAggregates: toBoolean(r.collectMonthlyAggregates),
        collectChatMessages: toBoolean(r.collectChatMessages),
        collectInteractions: toBoolean(r.collectInteractions),
        collectInteractionFrequency: toBoolean(r.collectInteractionFrequency),
        collectBadgeProgress: toBoolean(r.collectBadgeProgress),
        collectFootprintData: toBoolean(r.collectFootprintData),
        collectRankings: toBoolean(r.collectRankings),
        collectRadarAnalysis: toBoolean(r.collectRadarAnalysis),
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.viewerPrivacyConsent.createMany({ data, skipDuplicates: true }),
    ),

  deletionRequests: (turso: TursoClient) =>
    migrateTable(turso, "deletion_requests", 500,
      (r) => ({
        id: r.id as string,
        viewerId: r.viewerId as string,
        requestedAt: toDateRequired(r.requestedAt, "requestedAt"),
        executionScheduledAt: toDateRequired(r.executionScheduledAt, "executionScheduledAt"),
        status: toStr(r.status) ?? "pending",
      }),
      (data) => prisma.deletionRequest.createMany({ data, skipDuplicates: true }),
    ),

  exportJobs: (turso: TursoClient) =>
    migrateTable(turso, "export_jobs", 500,
      (r) => ({
        id: r.id as string,
        viewerId: r.viewerId as string,
        status: toStr(r.status) ?? "pending",
        downloadPath: toStr(r.downloadPath),
        expiresAt: toDate(r.expiresAt),
        errorMessage: toStr(r.errorMessage),
        createdAt: toDateRequired(r.createdAt, "createdAt"),
      }),
      (data) => prisma.exportJob.createMany({ data, skipDuplicates: true }),
    ),

  dataRetentionLogs: (turso: TursoClient) =>
    migrateTable(turso, "data_retention_logs", 500,
      (r) => ({
        id: r.id as string,
        viewerId: r.viewerId as string,
        action: r.action as string,
        reason: r.reason as string,
        executedAt: toDateRequired(r.executedAt, "executedAt"),
      }),
      (data) => prisma.dataRetentionLog.createMany({ data, skipDuplicates: true }),
    ),

  privacyAuditLogs: (turso: TursoClient) =>
    migrateTable(turso, "privacy_audit_logs", 500,
      (r) => ({
        id: r.id as string,
        viewerId: r.viewerId as string,
        action: r.action as string,
        details: r.details as string,
        ipAddress: toStr(r.ipAddress),
        userAgent: toStr(r.userAgent),
        timestamp: toDateRequired(r.timestamp, "timestamp"),
      }),
      (data) => prisma.privacyAuditLog.createMany({ data, skipDuplicates: true }),
    ),

  viewerChannelVideos: (turso: TursoClient) =>
    migrateTable(turso, "viewer_channel_videos", 500,
      (r) => ({
        id: r.id as string,
        twitchVideoId: r.twitchVideoId as string,
        channelId: r.channelId as string,
        title: r.title as string,
        url: r.url as string,
        thumbnailUrl: toStr(r.thumbnailUrl),
        viewCount: toInt(r.viewCount) ?? 0,
        duration: r.duration as string,
        publishedAt: toDateRequired(r.publishedAt, "publishedAt"),
        syncedAt: toDateRequired(r.syncedAt, "syncedAt"),
      }),
      (data) => prisma.viewerChannelVideo.createMany({ data, skipDuplicates: true }),
    ),

  viewerChannelClips: (turso: TursoClient) =>
    migrateTable(turso, "viewer_channel_clips", 500,
      (r) => ({
        id: r.id as string,
        twitchClipId: r.twitchClipId as string,
        channelId: r.channelId as string,
        creatorName: toStr(r.creatorName),
        title: r.title as string,
        url: r.url as string,
        thumbnailUrl: toStr(r.thumbnailUrl),
        viewCount: toInt(r.viewCount) ?? 0,
        duration: toFloat(r.duration) ?? 0,
        createdAt: toDateRequired(r.createdAt, "createdAt"),
        syncedAt: toDateRequired(r.syncedAt, "syncedAt"),
      }),
      (data) => prisma.viewerChannelClip.createMany({ data, skipDuplicates: true }),
    ),

  videos: (turso: TursoClient) =>
    migrateTable(turso, "videos", 500,
      (r) => ({
        id: r.id as string,
        twitchVideoId: r.twitchVideoId as string,
        streamerId: r.streamerId as string,
        title: r.title as string,
        description: toStr(r.description),
        url: r.url as string,
        thumbnailUrl: toStr(r.thumbnailUrl),
        viewCount: toInt(r.viewCount) ?? 0,
        duration: r.duration as string,
        language: toStr(r.language),
        type: r.type as string,
        createdAt: toDateRequired(r.createdAt, "createdAt"),
        publishedAt: toDateRequired(r.publishedAt, "publishedAt"),
        scrapedAt: toDateRequired(r.scrapedAt, "scrapedAt"),
      }),
      (data) => prisma.video.createMany({ data, skipDuplicates: true }),
    ),

  clips: (turso: TursoClient) =>
    migrateTable(turso, "clips", 500,
      (r) => ({
        id: r.id as string,
        twitchClipId: r.twitchClipId as string,
        streamerId: r.streamerId as string,
        creatorId: toStr(r.creatorId),
        creatorName: toStr(r.creatorName),
        videoId: toStr(r.videoId),
        gameId: toStr(r.gameId),
        title: r.title as string,
        url: r.url as string,
        embedUrl: toStr(r.embedUrl),
        thumbnailUrl: toStr(r.thumbnailUrl),
        viewCount: toInt(r.viewCount) ?? 0,
        duration: toFloat(r.duration) ?? 0,
        createdAt: toDateRequired(r.createdAt, "createdAt"),
        scrapedAt: toDateRequired(r.scrapedAt, "scrapedAt"),
      }),
      (data) => prisma.clip.createMany({ data, skipDuplicates: true }),
    ),

  streamerSettingTemplates: (turso: TursoClient) =>
    migrateTable(turso, "streamer_setting_templates", 500,
      (r) => ({
        id: r.id as string,
        streamerId: r.streamerId as string,
        templateName: r.templateName as string,
        title: toStr(r.title),
        gameId: toStr(r.gameId),
        gameName: toStr(r.gameName),
        tags: toStr(r.tags),
        language: toStr(r.language),
        createdAt: toDateRequired(r.createdAt, "createdAt"),
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.streamerSettingTemplate.createMany({ data, skipDuplicates: true }),
    ),

  subscriptionSnapshots: (turso: TursoClient) =>
    migrateTable(turso, "subscription_snapshots", 500,
      (r) => ({
        id: r.id as string,
        streamerId: r.streamerId as string,
        snapshotDate: toDateRequired(r.snapshotDate, "snapshotDate"),
        tier1Count: toInt(r.tier1Count) ?? 0,
        tier2Count: toInt(r.tier2Count) ?? 0,
        tier3Count: toInt(r.tier3Count) ?? 0,
        totalSubscribers: toInt(r.totalSubscribers) ?? 0,
        estimatedRevenue: toFloat(r.estimatedRevenue),
        createdAt: toDateRequired(r.createdAt, "createdAt"),
      }),
      (data) => prisma.subscriptionSnapshot.createMany({ data, skipDuplicates: true }),
    ),

  cheerEvents: (turso: TursoClient) =>
    migrateTable(turso, "cheer_events", 500,
      (r) => ({
        id: r.id as string,
        streamerId: r.streamerId as string,
        twitchUserId: toStr(r.twitchUserId),
        userName: toStr(r.userName),
        bits: toInt(r.bits) ?? 0,
        message: toStr(r.message),
        isAnonymous: toBoolean(r.isAnonymous),
        cheeredAt: toDateRequired(r.cheeredAt, "cheeredAt"),
        cheeredDate: toDate(r.cheeredDate),
        createdAt: toDateRequired(r.createdAt, "createdAt"),
      }),
      (data) => prisma.cheerEvent.createMany({ data, skipDuplicates: true }),
    ),

  cheerDailyAggs: (turso: TursoClient) =>
    migrateTable(turso, "cheer_daily_agg", 500,
      (r) => ({
        streamerId: r.streamerId as string,
        date: r.date as string,
        totalBits: toInt(r.totalBits) ?? 0,
        eventCount: toInt(r.eventCount) ?? 0,
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.cheerDailyAgg.createMany({ data, skipDuplicates: true }),
    ),

  channelHourlyStats: (turso: TursoClient) =>
    migrateTable(turso, "channel_hourly_stats", 500,
      (r) => ({
        channelId: r.channelId as string,
        dayOfWeek: toInt(r.dayOfWeek) ?? 0,
        hour: toInt(r.hour) ?? 0,
        totalHours: toFloat(r.totalHours) ?? 0,
        range: r.range as string,
        updatedAt: toDateRequired(r.updatedAt, "updatedAt"),
      }),
      (data) => prisma.channelHourlyStat.createMany({ data, skipDuplicates: true }),
    ),
};

// ────────────────────────────────────────────────────────────────────────────────
// 主程式
// ────────────────────────────────────────────────────────────────────────────────

async function main() {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (!tursoUrl) throw new Error("TURSO_DATABASE_URL 未設定");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未設定");

  const turso = createClient({ url: tursoUrl, authToken: tursoToken });

  console.log("=== 開始資料遷移 Turso → Supabase ===\n");

  // 按 FK 依賴順序執行
  const tasks = [
    () => migrate.systemSettings(turso),
    () => migrate.streamers(turso),
    () => migrate.viewers(turso),
    () => migrate.channels(turso),
    () => migrate.twitchTokens(turso),
    () => migrate.streamSessions(turso),
    () => migrate.streamMetrics(turso),
    () => migrate.channelDailyStats(turso),
    () => migrate.listenerInstances(turso),
    () => migrate.channelListenerLocks(turso),
    () => migrate.userFollows(turso),
    () => migrate.viewerChannelDailyStats(turso),
    () => migrate.viewerChannelMessages(turso),
    () => migrate.extensionHeartbeatDedups(turso),
    () => migrate.viewerChannelMessageDailyAggs(turso),
    () => migrate.viewerChannelLifetimeStats(turso),
    () => migrate.viewerChannelSummaries(turso),
    () => migrate.viewerDashboardLayouts(turso),
    () => migrate.viewerPrivacyConsents(turso),
    () => migrate.deletionRequests(turso),
    () => migrate.exportJobs(turso),
    () => migrate.dataRetentionLogs(turso),
    () => migrate.privacyAuditLogs(turso),
    () => migrate.viewerChannelVideos(turso),
    () => migrate.viewerChannelClips(turso),
    () => migrate.videos(turso),
    () => migrate.clips(turso),
    () => migrate.streamerSettingTemplates(turso),
    () => migrate.subscriptionSnapshots(turso),
    () => migrate.cheerEvents(turso),
    () => migrate.cheerDailyAggs(turso),
    () => migrate.channelHourlyStats(turso),
  ];

  const results: Array<{ tableName: string; migrated: number; failed: boolean; error?: string }> = [];

  for (const task of tasks) {
    try {
      const result = await task();
      results.push(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`錯誤:`, error);
      results.push({ tableName: "unknown", migrated: 0, failed: true, error });
    }
  }

  console.log("\n=== 遷移完成 ===");
  const totalMigrated = results.reduce((sum, r) => sum + r.migrated, 0);
  const failed = results.filter((r) => r.failed);
  console.log(`總共搬移: ${totalMigrated} 筆`);

  if (failed.length > 0) {
    console.error(`\n失敗的 table (${failed.length} 個):`);
    failed.forEach((r) => console.error(`  - ${r.tableName}: ${r.error}`));
    process.exit(1);
  } else {
    console.log("所有 table 遷移成功！");
  }

  await prisma.$disconnect();
  turso.close();
}

main().catch((err) => {
  console.error("遷移腳本執行失敗:", err);
  process.exit(1);
});
