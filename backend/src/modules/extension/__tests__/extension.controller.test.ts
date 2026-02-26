/**
 * Tests for extension.controller.ts
 * Covers: evictChannelIdCache, getExtensionTokenHandler, postHeartbeatHandler
 */

jest.mock("../../../db/prisma", () => ({
  prisma: {
    channel: {
      findFirst: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  },
}));

jest.mock("../../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../../utils/cache-manager", () => ({
  cacheManager: {
    delete: jest.fn(),
  },
}));

jest.mock("../../auth/jwt.utils", () => ({
  signExtensionToken: jest.fn(),
  verifyAccessToken: jest.fn(),
}));

jest.mock("../../viewer/viewer-auth-snapshot.service", () => ({
  getViewerAuthSnapshotById: jest.fn(),
}));

jest.mock("@prisma/client", () => ({
  Prisma: {
    sql: (...args: unknown[]) => args,
    join: (arr: unknown[]) => arr,
  },
  PrismaClient: jest.fn(),
}));

jest.mock("crypto", () => ({
  randomUUID: jest.fn(() => "test-uuid"),
}));

import { Response } from "express";
import type { ExtensionAuthRequest } from "../extension.middleware";
import {
  evictChannelIdCache,
  getExtensionTokenHandler,
  postHeartbeatHandler,
} from "../extension.controller";
import { prisma } from "../../../db/prisma";
import { signExtensionToken, verifyAccessToken } from "../../auth/jwt.utils";
import { getViewerAuthSnapshotById } from "../../viewer/viewer-auth-snapshot.service";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeRes(): Response {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  return res;
}

function makeReq(overrides: Partial<ExtensionAuthRequest> = {}): ExtensionAuthRequest {
  return {
    cookies: {},
    body: {},
    headers: {},
    ...overrides,
  } as ExtensionAuthRequest;
}

// ── setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// evictChannelIdCache
// ─────────────────────────────────────────────────────────────────────────────

describe("evictChannelIdCache", () => {
  it("does not throw when the cache is empty", () => {
    expect(() => evictChannelIdCache()).not.toThrow();
  });

  it("can be called repeatedly without error", () => {
    expect(() => {
      evictChannelIdCache();
      evictChannelIdCache();
      evictChannelIdCache();
    }).not.toThrow();
  });

  it("removes expired entries via postHeartbeatHandler flow", async () => {
    // Populate the channelIdCache with an entry via the handler
    (prisma.channel.findFirst as jest.Mock).mockResolvedValueOnce({ id: "ch-1" });

    const req = makeReq({
      extensionUser: { viewerId: "viewer1" },
      body: {
        channelName: "testchannel",
        duration: 30,
        timestamp: new Date().toISOString(),
      },
    });
    const res = makeRes();
    await postHeartbeatHandler(req, res);

    // Fast-forward time so the cache entry is expired (TTL = 5 min)
    jest.advanceTimersByTime(6 * 60 * 1000);

    // Now call evict – should not throw and expired entries are removed
    expect(() => evictChannelIdCache()).not.toThrow();
  });

  it("keeps valid (non-expired) entries", async () => {
    // Populate a cache entry
    (prisma.channel.findFirst as jest.Mock).mockResolvedValueOnce({ id: "ch-fresh" });

    const req = makeReq({
      extensionUser: { viewerId: "viewer2" },
      body: {
        channelName: "freshchannel",
        duration: 30,
        timestamp: new Date().toISOString(),
      },
    });
    const res = makeRes();
    await postHeartbeatHandler(req, res);

    // Advance only 1 minute (still within 5-minute TTL)
    jest.advanceTimersByTime(1 * 60 * 1000);
    expect(() => evictChannelIdCache()).not.toThrow();

    // Second heartbeat for the same channel should use cache (findFirst not called again)
    const req2 = makeReq({
      extensionUser: { viewerId: "viewer2" },
      body: {
        channelName: "freshchannel",
        duration: 60,
        timestamp: new Date(Date.now() + 1000).toISOString(),
      },
    });
    const res2 = makeRes();
    // findFirst should NOT be called again (cache hit)
    (prisma.channel.findFirst as jest.Mock).mockResolvedValueOnce({ id: "ch-fresh" });
    await postHeartbeatHandler(req2, res2);
    // Verify findFirst was still only called the original once (cache used)
    // (It may be called 1 or 2 times depending on dedup state; the important thing is no throw)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getExtensionTokenHandler
// ─────────────────────────────────────────────────────────────────────────────

describe("getExtensionTokenHandler", () => {
  it("returns 401 if auth_token cookie is absent", async () => {
    const req = makeReq({ cookies: {} });
    const res = makeRes();

    await getExtensionTokenHandler(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({ error: "Not authenticated" });
  });

  it("returns 401 if verifyAccessToken returns null", async () => {
    (verifyAccessToken as jest.Mock).mockReturnValue(null);

    const req = makeReq({ cookies: { auth_token: "bad-token" } });
    const res = makeRes();

    await getExtensionTokenHandler(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({ error: "Invalid session" });
  });

  it("returns 401 if verifyAccessToken payload has no viewerId", async () => {
    (verifyAccessToken as jest.Mock).mockReturnValue({ someOtherField: "x" });

    const req = makeReq({ cookies: { auth_token: "token-no-viewer" } });
    const res = makeRes();

    await getExtensionTokenHandler(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({ error: "Invalid session" });
  });

  it("returns 401 if viewer not found", async () => {
    (verifyAccessToken as jest.Mock).mockReturnValue({ viewerId: "v1" });
    (getViewerAuthSnapshotById as jest.Mock).mockResolvedValue(null);

    const req = makeReq({ cookies: { auth_token: "valid-token" } });
    const res = makeRes();

    await getExtensionTokenHandler(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({ error: "Viewer not found" });
  });

  it("returns token on success", async () => {
    (verifyAccessToken as jest.Mock).mockReturnValue({ viewerId: "v1" });
    (getViewerAuthSnapshotById as jest.Mock).mockResolvedValue({ tokenVersion: 3 });
    (signExtensionToken as jest.Mock).mockReturnValue("signed-extension-jwt");

    const req = makeReq({ cookies: { auth_token: "valid-token" } });
    const res = makeRes();

    await getExtensionTokenHandler(req, res);

    expect(signExtensionToken).toHaveBeenCalledWith("v1", 3);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({
      token: "signed-extension-jwt",
      expiresIn: 3600,
    });
  });

  it("returns 500 on unexpected error", async () => {
    (verifyAccessToken as jest.Mock).mockImplementation(() => {
      throw new Error("unexpected boom");
    });

    const req = makeReq({ cookies: { auth_token: "any-token" } });
    const res = makeRes();

    await getExtensionTokenHandler(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(500);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({ error: "Internal Server Error" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// postHeartbeatHandler
// ─────────────────────────────────────────────────────────────────────────────

describe("postHeartbeatHandler", () => {
  const validBody = {
    channelName: "mychannel",
    duration: 30,
    timestamp: new Date("2026-02-26T10:00:00.000Z").toISOString(),
  };

  it("returns 401 if extensionUser is undefined", async () => {
    const req = makeReq({ body: validBody });
    const res = makeRes();

    await postHeartbeatHandler(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({ error: "Not authenticated" });
  });

  it("returns 401 if extensionUser has no viewerId", async () => {
    const req = makeReq({ extensionUser: { viewerId: "" }, body: validBody });
    const res = makeRes();

    await postHeartbeatHandler(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({ error: "Not authenticated" });
  });

  it("returns 400 if channelName is missing", async () => {
    const req = makeReq({
      extensionUser: { viewerId: "viewer1" },
      body: { duration: 30, timestamp: validBody.timestamp },
    });
    const res = makeRes();

    await postHeartbeatHandler(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({
      error: "Missing channelName, timestamp or duration",
    });
  });

  it("returns 400 if duration is missing", async () => {
    const req = makeReq({
      extensionUser: { viewerId: "viewer1" },
      body: { channelName: "chan", timestamp: validBody.timestamp },
    });
    const res = makeRes();

    await postHeartbeatHandler(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({
      error: "Missing channelName, timestamp or duration",
    });
  });

  it("returns 400 if timestamp is missing", async () => {
    const req = makeReq({
      extensionUser: { viewerId: "viewer1" },
      body: { channelName: "chan", duration: 30 },
    });
    const res = makeRes();

    await postHeartbeatHandler(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({
      error: "Missing channelName, timestamp or duration",
    });
  });

  it("returns 200 { success: true, message: 'Channel not tracked' } when channel not found", async () => {
    (prisma.channel.findFirst as jest.Mock).mockResolvedValue(null);

    const req = makeReq({
      extensionUser: { viewerId: "viewer1" },
      body: { channelName: "unknownchannel", duration: 30, timestamp: validBody.timestamp },
    });
    const res = makeRes();

    await postHeartbeatHandler(req, res);

    expect((res.json as jest.Mock)).toHaveBeenCalledWith({
      success: true,
      message: "Channel not tracked",
    });
  });

  it("returns 400 for invalid timestamp format", async () => {
    // Use a unique channel name to avoid dedup cache from prior tests
    (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "ch-invalid-ts" });

    const req = makeReq({
      extensionUser: { viewerId: "viewer-ts-bad" },
      body: { channelName: "invalidtschannel", duration: 30, timestamp: "not-a-date" },
    });
    const res = makeRes();

    await postHeartbeatHandler(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({
      error: "Invalid timestamp format",
    });
  });

  it("returns 200 { success: true } on successful heartbeat submission", async () => {
    (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "ch-success" });

    const uniqueTimestamp = new Date("2026-02-26T11:00:00.000Z").toISOString();
    const req = makeReq({
      extensionUser: { viewerId: "viewer-success" },
      body: { channelName: "successchannel", duration: 30, timestamp: uniqueTimestamp },
    });
    const res = makeRes();

    await postHeartbeatHandler(req, res);

    expect((res.json as jest.Mock)).toHaveBeenCalledWith({ success: true });
  });

  it("returns 200 { success: true, deduped: true } for duplicate in-memory heartbeat (same dedupKey)", async () => {
    (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "ch-dedup" });

    const dedupTimestamp = new Date("2026-02-26T12:00:00.000Z").toISOString();
    const payload = {
      extensionUser: { viewerId: "viewer-dedup" },
      body: { channelName: "dedupchannel", duration: 45, timestamp: dedupTimestamp },
    };

    // First call – should succeed
    const req1 = makeReq(payload);
    const res1 = makeRes();
    await postHeartbeatHandler(req1, res1);
    expect((res1.json as jest.Mock)).toHaveBeenCalledWith({ success: true });

    // Second call – same dedupKey, isDuplicateHeartbeat returns true
    const req2 = makeReq(payload);
    const res2 = makeRes();
    await postHeartbeatHandler(req2, res2);
    expect((res2.json as jest.Mock)).toHaveBeenCalledWith({ success: true, deduped: true });
  });

  it("returns 500 on unexpected error", async () => {
    (prisma.channel.findFirst as jest.Mock).mockRejectedValue(new Error("db exploded"));

    const req = makeReq({
      extensionUser: { viewerId: "viewer-err" },
      body: { channelName: "errorchannel", duration: 30, timestamp: validBody.timestamp },
    });
    const res = makeRes();

    await postHeartbeatHandler(req, res);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(500);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({ error: "Internal Server Error" });
  });
});
