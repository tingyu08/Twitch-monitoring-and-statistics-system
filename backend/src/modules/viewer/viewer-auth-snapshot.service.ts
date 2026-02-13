import { prisma } from "../../db/prisma";
import { cacheManager } from "../../utils/cache-manager";

const VIEWER_AUTH_SNAPSHOT_TTL_SECONDS = Number(
  process.env.VIEWER_AUTH_SNAPSHOT_TTL_SECONDS || 120
);

export interface ViewerAuthSnapshot {
  id: string;
  twitchUserId: string;
  tokenVersion: number;
  consentedAt: Date | null;
  consentVersion: number;
  isAnonymized: boolean;
}

function byIdKey(viewerId: string): string {
  return `viewer-auth:id:${viewerId}`;
}

function byTwitchIdKey(twitchUserId: string): string {
  return `viewer-auth:twitch:${twitchUserId}`;
}

function cacheSnapshot(snapshot: ViewerAuthSnapshot): void {
  const tags = [`viewer:${snapshot.id}`, "viewer-auth-snapshot"];
  cacheManager.setWithTags(byIdKey(snapshot.id), snapshot, VIEWER_AUTH_SNAPSHOT_TTL_SECONDS, tags);
  cacheManager.setWithTags(
    byTwitchIdKey(snapshot.twitchUserId),
    snapshot,
    VIEWER_AUTH_SNAPSHOT_TTL_SECONDS,
    tags
  );
}

export async function getViewerAuthSnapshotById(
  viewerId: string
): Promise<ViewerAuthSnapshot | null> {
  const snapshot = await cacheManager.getOrSetWithTags<ViewerAuthSnapshot | null>(
    byIdKey(viewerId),
    async () =>
      prisma.viewer.findUnique({
        where: { id: viewerId },
        select: {
          id: true,
          twitchUserId: true,
          tokenVersion: true,
          consentedAt: true,
          consentVersion: true,
          isAnonymized: true,
        },
      }),
    VIEWER_AUTH_SNAPSHOT_TTL_SECONDS,
    [`viewer:${viewerId}`, "viewer-auth-snapshot"]
  );

  if (!snapshot) {
    return null;
  }

  cacheSnapshot(snapshot);
  return snapshot;
}

export async function getViewerAuthSnapshotByTwitchUserId(
  twitchUserId: string
): Promise<ViewerAuthSnapshot | null> {
  const snapshot = await cacheManager.getOrSetWithTags<ViewerAuthSnapshot | null>(
    byTwitchIdKey(twitchUserId),
    async () =>
      prisma.viewer.findUnique({
        where: { twitchUserId },
        select: {
          id: true,
          twitchUserId: true,
          tokenVersion: true,
          consentedAt: true,
          consentVersion: true,
          isAnonymized: true,
        },
      }),
    VIEWER_AUTH_SNAPSHOT_TTL_SECONDS,
    ["viewer-auth-snapshot"]
  );

  if (!snapshot) {
    return null;
  }

  cacheSnapshot(snapshot);
  return snapshot;
}

export function invalidateViewerAuthSnapshot(viewerId?: string, twitchUserId?: string): void {
  if (viewerId) {
    cacheManager.delete(byIdKey(viewerId));
  }

  if (twitchUserId) {
    cacheManager.delete(byTwitchIdKey(twitchUserId));
  }
}
