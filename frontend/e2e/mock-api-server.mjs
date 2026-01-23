/**
 * Mock API Server for E2E Testing
 *
 * This server provides mock responses for E2E tests.
 * Run with: node e2e/mock-api-server.mjs
 */

import http from "http";

const PORT = 4001;

const mockViewerUser = {
  id: "viewer-123",
  displayName: "測試觀眾",
  avatarUrl: "https://ui-avatars.com/api/?name=Test",
  role: "viewer",
  isViewer: true,
  viewerId: "v-123",
  consentedAt: "2025-01-01T00:00:00Z",
};

const mockChannels = [
  {
    id: "ch_1",
    channelName: "shroud",
    displayName: "Shroud",
    avatarUrl: "https://ui-avatars.com/api/?name=Shroud",
    isLive: true,
    totalWatchMinutes: 210,
    messageCount: 12,
  },
];

const mockDailyStats = [
  { date: "2025-01-01T00:00:00Z", watchHours: 2.5, messageCount: 10, emoteCount: 5 },
  { date: "2025-01-02T00:00:00Z", watchHours: 1.0, messageCount: 2, emoteCount: 1 },
];

const mockLifetimeStats = {
  channelId: "ch_1",
  channelName: "shroud",
  channelDisplayName: "Shroud",
  lifetimeStats: {
    watchTime: {
      totalMinutes: 120,
      totalHours: 2,
      avgSessionMinutes: 60,
      firstWatchedAt: "2025-01-01",
      lastWatchedAt: "2025-01-02",
    },
    messages: { totalMessages: 10, chatMessages: 10, subscriptions: 0, cheers: 0, totalBits: 0 },
    loyalty: { trackingDays: 2, longestStreakDays: 2, currentStreakDays: 1 },
    activity: {
      activeDaysLast30: 2,
      activeDaysLast90: 2,
      mostActiveMonth: "2025-01",
      mostActiveMonthCount: 2,
    },
    rankings: { watchTimePercentile: 50, messagePercentile: 50 },
  },
  badges: [],
  radarScores: {
    watchTime: 20,
    interaction: 10,
    loyalty: 10,
    activity: 10,
    contribution: 0,
    community: 0,
  },
};

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  res.setHeader("Content-Type", "application/json");

  const url = req.url || "";
  console.log(`[Mock API] ${req.method} ${url}`);

  // Route handling
  if (url === "/api/auth/me") {
    res.writeHead(200);
    res.end(JSON.stringify(mockViewerUser));
  } else if (url === "/api/viewer/channels") {
    res.writeHead(200);
    res.end(JSON.stringify(mockChannels));
  } else if (url.startsWith("/api/viewer/stats/")) {
    res.writeHead(200);
    res.end(JSON.stringify(mockDailyStats));
  } else if (url.match(/\/api\/viewer\/.*\/channels\/.*\/lifetime-stats/)) {
    res.writeHead(200);
    res.end(JSON.stringify(mockLifetimeStats));
  } else if (url.startsWith("/api/viewer/dashboard-layout/")) {
    res.writeHead(200);
    res.end(JSON.stringify({ layout: null }));
  } else if (url === "/api/viewer/dashboard-layout" && req.method === "POST") {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true }));
  } else {
    console.log(`[Mock API] Unknown route: ${url}`);
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(PORT, () => {
  console.log(`🧪 Mock API Server running at http://localhost:${PORT}`);
  console.log("Press Ctrl+C to stop");
});
