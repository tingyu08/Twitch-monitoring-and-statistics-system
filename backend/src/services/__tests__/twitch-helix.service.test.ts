import { twurpleHelixService } from "../twitch-helix.service";
import { ApiClient } from "@twurple/api";

jest.mock("../twurple-auth.service", () => ({
  twurpleAuthService: {
    getAppAuthProvider: jest.fn().mockReturnValue({}),
    getStatus: jest.fn().mockReturnValue({ status: "ok" }),
  },
}));

jest.mock("@twurple/api", () => {
  const mockApi = {
    users: {
      getUserByName: jest.fn(),
      getUserById: jest.fn(),
      getUsersByIds: jest.fn(),
    },
    channels: {
      getChannelInfoById: jest.fn(),
      getChannelFollowerCount: jest.fn(),
    },
    streams: {
      getStreamByUserId: jest.fn(),
      getStreamsByUserIds: jest.fn(),
    },
  };
  return {
    ApiClient: jest.fn().mockImplementation(() => mockApi),
  };
});

describe("TwurpleHelixService", () => {
  let mockApi: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApi =
      (ApiClient as jest.Mock).mock.results[0]?.value ||
      new (ApiClient as jest.Mock)();
    // Reset individual mocks
    mockApi.users.getUserByName.mockReset();
    mockApi.users.getUserById.mockReset();
    mockApi.users.getUsersByIds.mockReset();
    mockApi.channels.getChannelInfoById.mockReset();
    mockApi.channels.getChannelFollowerCount.mockReset();
    mockApi.streams.getStreamByUserId.mockReset();
    mockApi.streams.getStreamsByUserIds.mockReset();
  });

  describe("getUsersByIds", () => {
    it("should return users array", async () => {
      mockApi.users.getUsersByIds.mockResolvedValue([
        {
          id: "1",
          name: "a",
          displayName: "A",
          type: "",
          broadcasterType: "",
          description: "",
          profilePictureUrl: "",
          offlinePlaceholderUrl: "",
          creationDate: new Date(),
        },
      ]);
      const result = await twurpleHelixService.getUsersByIds(["1"]);
      expect(result).toHaveLength(1);
    });

    it("should return empty array on exception", async () => {
      mockApi.users.getUsersByIds.mockRejectedValue(new Error("Fail"));
      const result = await twurpleHelixService.getUsersByIds(["1"]);
      expect(result).toEqual([]);
    });
  });

  describe("Channel APIs", () => {
    it("getChannelInfo should return info", async () => {
      mockApi.channels.getChannelInfoById.mockResolvedValue({
        id: "1",
        name: "a",
        displayName: "A",
        language: "en",
        gameId: "g1",
        gameName: "G",
        title: "T",
      });
      const result = await twurpleHelixService.getChannelInfo("1");
      expect(result?.broadcasterId).toBe("1");
    });
  });

  describe("Stream APIs", () => {
    it("getStream should return info", async () => {
      mockApi.streams.getStreamByUserId.mockResolvedValue({
        id: "s1",
        userId: "1",
        userName: "a",
        userDisplayName: "A",
        gameId: "g1",
        gameName: "G",
        type: "live",
        title: "T",
        viewers: 10,
        startDate: new Date(),
        language: "en",
        thumbnailUrl: "url",
        isMature: false,
      });
      const result = await twurpleHelixService.getStream("1");
      expect(result?.id).toBe("s1");
    });
  });
});
