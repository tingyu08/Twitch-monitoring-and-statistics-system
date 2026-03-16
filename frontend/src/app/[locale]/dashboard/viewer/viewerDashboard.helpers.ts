import type { FollowedChannel } from "@/lib/api/viewer";

export function buildAvatarUrl(channel: FollowedChannel): string {
  return (
    channel.avatarUrl ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(channel.displayName)}&background=6366f1&color=fff`
  );
}

export function formatStreamDuration(startedAt: string): string {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function filterAndSortChannels(
  channels: FollowedChannel[] | null | undefined,
  searchQuery: string
) {
  /* istanbul ignore next */
  const sourceChannels = Array.isArray(channels) ? channels : [];
  const lowerQuery = searchQuery.trim().toLowerCase();
  const filtered =
    lowerQuery.length > 0
      ? sourceChannels.filter(
          (ch) =>
            ch.channelName.toLowerCase().includes(lowerQuery) ||
            ch.displayName.toLowerCase().includes(lowerQuery)
        )
      : [...sourceChannels];

  filtered.sort((a, b) => {
    if (a.isLive && !b.isLive) return -1;
    if (!a.isLive && b.isLive) return 1;

    const messageDiff = (b.messageCount || 0) - (a.messageCount || 0);
    if (messageDiff !== 0) return messageDiff;

    if (a.isLive && b.isLive) {
      const aStarted = a.streamStartedAt ? new Date(a.streamStartedAt).getTime() : 0;
      const bStarted = b.streamStartedAt ? new Date(b.streamStartedAt).getTime() : 0;
      if (aStarted !== bStarted) return bStarted - aStarted;

      const aFollowed = a.followedAt ? new Date(a.followedAt).getTime() : 0;
      const bFollowed = b.followedAt ? new Date(b.followedAt).getTime() : 0;
      if (aFollowed !== bFollowed) return bFollowed - aFollowed;

      const displayDiff = a.displayName.localeCompare(b.displayName, "zh-Hant");
      if (displayDiff !== 0) return displayDiff;

      return a.id.localeCompare(b.id);
    }

    const aLast = a.lastWatched ? new Date(a.lastWatched).getTime() : 0;
    const bLast = b.lastWatched ? new Date(b.lastWatched).getTime() : 0;
    if (aLast !== bLast) return bLast - aLast;

    const aFollowed = a.followedAt ? new Date(a.followedAt).getTime() : 0;
    const bFollowed = b.followedAt ? new Date(b.followedAt).getTime() : 0;
    if (aFollowed !== bFollowed) return bFollowed - aFollowed;

    const displayDiff = a.displayName.localeCompare(b.displayName, "zh-Hant");
    if (displayDiff !== 0) return displayDiff;

    return a.id.localeCompare(b.id);
  });

  return filtered;
}

export function getCurrentPageChannels(channels: FollowedChannel[], currentPage: number, perPage: number) {
  const startIndex = (currentPage - 1) * perPage;
  const endIndex = startIndex + perPage;
  return channels.slice(startIndex, endIndex);
}

export function buildListenChannelsPayload(channels: FollowedChannel[]) {
  return channels
    .filter((ch) => ch.isLive)
    .map((ch) => ({ channelName: ch.channelName, isLive: true }));
}

export function applyStreamOnlineUpdate(
  ch: FollowedChannel,
  data: {
    viewerCount?: number;
    startedAt?: string;
    title?: string;
    gameName?: string;
  }
) {
  const nextViewerCount = data.viewerCount ?? ch.viewerCount;
  const nextCurrentViewerCount = data.viewerCount ?? ch.currentViewerCount ?? 0;
  const nextTitle = data.title || ch.currentTitle;
  const nextGame = data.gameName || ch.currentGameName;
  const nextStartedAt =
    data.startedAt || ch.currentStreamStartedAt || ch.streamStartedAt || new Date().toISOString();

  if (
    ch.isLive &&
    ch.viewerCount === nextViewerCount &&
    ch.currentViewerCount === nextCurrentViewerCount &&
    ch.currentTitle === nextTitle &&
    ch.currentGameName === nextGame &&
    ch.currentStreamStartedAt === nextStartedAt &&
    ch.streamStartedAt === nextStartedAt
  ) {
    return ch;
  }

  return {
    ...ch,
    isLive: true,
    viewerCount: nextViewerCount,
    streamStartedAt: nextStartedAt,
    currentTitle: nextTitle,
    currentGameName: nextGame,
    currentViewerCount: nextCurrentViewerCount,
    currentStreamStartedAt: nextStartedAt,
  };
}

export function applyStreamOfflineUpdate(ch: FollowedChannel) {
  if (!ch.isLive && ch.viewerCount === 0 && (ch.currentViewerCount ?? 0) === 0 && !ch.currentStreamStartedAt) {
    return ch;
  }

  return {
    ...ch,
    isLive: false,
    viewerCount: 0,
    streamStartedAt: null,
    currentViewerCount: 0,
    currentStreamStartedAt: undefined,
  };
}

export function applyChannelUpdate(
  ch: FollowedChannel,
  data: { viewerCount?: number; title?: string; gameName?: string; startedAt?: string }
) {
  const nextViewerCount = data.viewerCount ?? ch.viewerCount;
  const nextCurrentViewerCount = data.viewerCount ?? ch.currentViewerCount;
  const nextTitle = data.title || ch.currentTitle;
  const nextGame = data.gameName || ch.currentGameName;
  const nextStartedAt = data.startedAt || ch.currentStreamStartedAt;

  if (
    ch.viewerCount === nextViewerCount &&
    ch.currentViewerCount === nextCurrentViewerCount &&
    ch.currentTitle === nextTitle &&
    ch.currentGameName === nextGame &&
    ch.currentStreamStartedAt === nextStartedAt
  ) {
    return ch;
  }

  return {
    ...ch,
    viewerCount: nextViewerCount,
    currentViewerCount: nextCurrentViewerCount,
    currentTitle: nextTitle,
    currentGameName: nextGame,
    currentStreamStartedAt: nextStartedAt,
  };
}

export function applyStatsDelta(ch: FollowedChannel, messageCountDelta: number) {
  return {
    ...ch,
    messageCount: ch.messageCount + messageCountDelta,
  };
}
