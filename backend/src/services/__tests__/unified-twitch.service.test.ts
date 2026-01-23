// --- Mocks BEFORE Imports ---
jest.mock("../twitch-chat.service", () => ({
  twurpleChatService: {
    initialize: jest.fn(),
    start: jest.fn(),
    joinChannel: jest.fn(),
    leaveChannel: jest.fn(),
    getStatus: jest.fn().mockReturnValue({ connected: true }),
  },
}));

jest.mock("../twitch-helix.service", () => ({
  twurpleHelixService: {
    healthCheck: jest.fn().mockResolvedValue(true),
    getUserByLogin: jest.fn(),
    getStream: jest.fn(),
    getFollowerCount: jest.fn(),
    getStreamsByUserIds: jest.fn().mockResolvedValue([]),
    getStatus: jest.fn().mockReturnValue({ status: "healthy" }),
  },
}));

jest.mock("../decapi.service", () => ({
  decApiService: {
    getFollowage: jest.fn(),
    getAccountAge: jest.fn(),
    getCacheStats: jest.fn().mockReturnValue({}),
  },
}));

jest.mock("../twurple-auth.service", () => ({
  twurpleAuthService: {
    getStatus: jest.fn().mockReturnValue({ status: "healthy" }),
  },
}));

import { unifiedTwitchService } from "../unified-twitch.service";
import { twurpleHelixService } from "../twitch-helix.service";
import { decApiService } from "../decapi.service";
import { twurpleChatService } from "../twitch-chat.service";

describe("UnifiedTwitchService Integration Test", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getChannelInfo", () => {
    it("should return channel info when API call succeeds", async () => {
      // Setup Mock Data
      const mockHelixUser = {
        id: "123",
        login: "testuser",
        displayName: "TestUser",
        profileImageUrl: "http://avatar.jpg",
      };

      const mockStream = {
        type: "live",
        gameName: "Coding",
        title: "Building Tests",
        viewerCount: 100,
      };

      // Mock Implementation
      (twurpleHelixService.getUserByLogin as jest.Mock).mockResolvedValue(mockHelixUser);
      (twurpleHelixService.getStream as jest.Mock).mockResolvedValue(mockStream);
      (twurpleHelixService.getFollowerCount as jest.Mock).mockResolvedValue(500);

      // Execute
      const result = await unifiedTwitchService.getChannelInfo("testuser");

      // Verify
      expect(twurpleHelixService.getUserByLogin).toHaveBeenCalledWith("testuser");
      expect(result).not.toBeNull();
      expect(result?.login).toBe("testuser");
      expect(result?.isLive).toBe(true);
      expect(result?.followerCount).toBe(500);
    });

    it("should return null if user not found", async () => {
      (twurpleHelixService.getUserByLogin as jest.Mock).mockResolvedValue(null);
      const result = await unifiedTwitchService.getChannelInfo("unknown");
      expect(result).toBeNull();
    });
  });

  describe("getStreamsByUserIds (Story 3.3 Batch)", () => {
    it("should fetch streams in batch", async () => {
      const mockStreams = [
        { userId: "1", type: "live", viewers: 100 },
        { userId: "2", type: "live", viewers: 50 },
      ];

      (twurpleHelixService.getStreamsByUserIds as jest.Mock).mockResolvedValue(mockStreams);

      const result = await unifiedTwitchService.getStreamsByUserIds(["1", "2", "3"]);

      expect(twurpleHelixService.getStreamsByUserIds).toHaveBeenCalledWith(["1", "2", "3"]);
      expect(result).toHaveLength(2);
    });
  });

  describe("getUserFollowInfo", () => {
    it("should return follow info from decApiService", async () => {
      const mockFollowage = {
        isFollowing: true,
        followedAt: "2023-01-01",
        duration: "1 year",
      };
      (decApiService.getFollowage as jest.Mock).mockResolvedValue(mockFollowage);

      const result = await unifiedTwitchService.getUserFollowInfo("channel", "user");

      expect(decApiService.getFollowage).toHaveBeenCalledWith("channel", "user");
      expect(result.isFollowing).toBe(true);
      expect(result.followedAt).toBe("2023-01-01");
    });
  });

  describe("getViewerChannelRelation", () => {
    it("should return full relation info", async () => {
      const mockChannel = {
        id: "123",
        login: "channel",
        displayName: "Channel",
      };
      const mockFollow = { isFollowing: true };
      const mockAge = { age: "2 years" };

      jest.spyOn(unifiedTwitchService, "getChannelInfo").mockResolvedValue(mockChannel as any);
      jest.spyOn(unifiedTwitchService, "getUserFollowInfo").mockResolvedValue(mockFollow as any);
      (decApiService.getAccountAge as jest.Mock).mockResolvedValue(mockAge);

      const result = await unifiedTwitchService.getViewerChannelRelation("channel", "viewer");

      expect(result?.channel).toEqual(mockChannel);
      expect(result?.followInfo).toEqual(mockFollow);
      expect(result?.viewerAccountAge).toBe("2 years");
    });
  });

  describe("Chat Listening Management", () => {
    it("startListeningToChannel should call joinChannel", async () => {
      await unifiedTwitchService.startListeningToChannel("channel");
      expect(twurpleChatService.joinChannel).toHaveBeenCalledWith("channel");
    });

    it("stopListeningToChannel should call leaveChannel", async () => {
      await unifiedTwitchService.stopListeningToChannel("channel");
      expect(twurpleChatService.leaveChannel).toHaveBeenCalledWith("channel");
    });
  });

  describe("checkLiveStatus", () => {
    it("should return a map of live status", async () => {
      const mockStreams = [{ userId: "1" }];
      (twurpleHelixService.getStreamsByUserIds as jest.Mock).mockResolvedValue(mockStreams);

      const result = await unifiedTwitchService.checkLiveStatus(["1", "2"]);

      expect(result.get("1")).toBe(true);
      expect(result.get("2")).toBe(false);
    });
  });

  describe("initialize", () => {
    it("should initialize services", async () => {
      await unifiedTwitchService.initialize();
      expect(twurpleChatService.initialize).toHaveBeenCalled();
      expect(twurpleHelixService.healthCheck).toHaveBeenCalled();
    });
  });
});
