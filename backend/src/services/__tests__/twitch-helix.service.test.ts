import { twurpleHelixService } from "../twitch-helix.service";
import * as esmImportUtils from "../../utils/esm-import";

// Define mock functions at module level (accessible in tests)
const mockUsersApi = {
  getUserByName: jest.fn(),
  getUserById: jest.fn(),
  getUsersByIds: jest.fn(),
};

const mockChannelsApi = {
  getChannelInfoById: jest.fn(),
  getChannelFollowerCount: jest.fn(),
};

const mockStreamsApi = {
  getStreamByUserId: jest.fn(),
  getStreamsByUserIds: jest.fn(),
};

const mockHelixApiClientInstance = {
  users: mockUsersApi,
  channels: mockChannelsApi,
  streams: mockStreamsApi,
};

// Mock the ESM loader utility (Basic mock structure)
jest.mock("../../utils/esm-import", () => ({
  importTwurpleApi: jest.fn(),
  importTwurpleAuth: jest.fn(),
}));

// Mock Auth Service
jest.mock("../twurple-auth.service", () => ({
  twurpleAuthService: {
    getAppAuthProvider: jest.fn().mockReturnValue({}),
    getStatus: jest.fn().mockReturnValue({ status: "ok" }),
  },
}));

describe("TwurpleHelixService", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup the mock implementation for importTwurpleApi
    // This runs after hoisting, so we can access outer variables
    (esmImportUtils.importTwurpleApi as jest.Mock).mockResolvedValue({
      ApiClient: jest.fn().mockImplementation(() => mockHelixApiClientInstance),
    });

    (esmImportUtils.importTwurpleAuth as jest.Mock).mockResolvedValue({
      StaticAuthProvider: jest.fn(),
      RefreshingAuthProvider: jest.fn(),
    });
  });

  describe("getUsersByIds", () => {
    it("should return users array", async () => {
      mockUsersApi.getUsersByIds.mockResolvedValue([
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
      mockUsersApi.getUsersByIds.mockRejectedValue(new Error("Fail"));
      const result = await twurpleHelixService.getUsersByIds(["1"]);
      expect(result).toEqual([]);
    });
  });

  describe("Channel APIs", () => {
    it("getChannelInfo should return info", async () => {
      mockChannelsApi.getChannelInfoById.mockResolvedValue({
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
      mockStreamsApi.getStreamByUserId.mockResolvedValue({
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
