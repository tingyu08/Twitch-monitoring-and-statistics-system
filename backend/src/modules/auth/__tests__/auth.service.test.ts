import { handleTwitchCallback } from "../auth.service";
import * as twitchOAuthClient from "../twitch-oauth.client";

// Mock Twitch OAuth client
jest.mock("../twitch-oauth.client");

// Mock environment variables
process.env.APP_JWT_SECRET = "test-secret-key-for-service-testing";

describe("Auth Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("handleTwitchCallback", () => {
    const mockCode = "test_oauth_code_123";

    const mockTokenResponse = {
      access_token: "mock_access_token",
      refresh_token: "mock_refresh_token",
      expires_in: 3600,
      scope: ["user:read:email"],
      token_type: "bearer",
    };

    const mockTwitchUser = {
      id: "twitch_user_123",
      login: "teststreamer",
      display_name: "Test Streamer",
      profile_image_url: "https://static-cdn.jtvnw.net/user-default-pictures/test.jpg",
    };

    it("should create new streamer and return JWT token", async () => {
      (twitchOAuthClient.exchangeCodeForToken as jest.Mock).mockResolvedValue(
        mockTokenResponse
      );
      (twitchOAuthClient.fetchTwitchUser as jest.Mock).mockResolvedValue(
        mockTwitchUser
      );

      const result = await handleTwitchCallback(mockCode);

      expect(result.streamer).toBeDefined();
      expect(result.streamer.twitchUserId).toBe("twitch_user_123");
      expect(result.streamer.displayName).toBe("Test Streamer");
      expect(result.streamer.channelUrl).toBe(
        "https://www.twitch.tv/teststreamer"
      );
      expect(result.jwtToken).toBeDefined();
      expect(typeof result.jwtToken).toBe("string");

      expect(twitchOAuthClient.exchangeCodeForToken).toHaveBeenCalledWith(
        mockCode
      );
      expect(twitchOAuthClient.fetchTwitchUser).toHaveBeenCalledWith(
        "mock_access_token"
      );
    });

    it("should update existing streamer and return JWT token", async () => {
      (twitchOAuthClient.exchangeCodeForToken as jest.Mock).mockResolvedValue(
        mockTokenResponse
      );
      (twitchOAuthClient.fetchTwitchUser as jest.Mock).mockResolvedValue(
        mockTwitchUser
      );

      // First call - create streamer
      const result1 = await handleTwitchCallback(mockCode);
      const streamerId1 = result1.streamer.id;

      // Second call - update streamer
      const updatedUser = {
        ...mockTwitchUser,
        display_name: "Updated Streamer Name",
        profile_image_url: "https://example.com/new-avatar.jpg",
      };
      (twitchOAuthClient.fetchTwitchUser as jest.Mock).mockResolvedValue(
        updatedUser
      );

      const result2 = await handleTwitchCallback(mockCode);

      expect(result2.streamer.id).toBe(streamerId1); // Same streamer ID
      expect(result2.streamer.displayName).toBe("Updated Streamer Name");
      expect(result2.streamer.avatarUrl).toBe(
        "https://example.com/new-avatar.jpg"
      );
      expect(result2.jwtToken).toBeDefined();
    });

    it("should generate correct channel URL from Twitch login", async () => {
      (twitchOAuthClient.exchangeCodeForToken as jest.Mock).mockResolvedValue(
        mockTokenResponse
      );
      (twitchOAuthClient.fetchTwitchUser as jest.Mock).mockResolvedValue({
        ...mockTwitchUser,
        login: "differentstreamer",
      });

      const result = await handleTwitchCallback(mockCode);

      expect(result.streamer.channelUrl).toBe(
        "https://www.twitch.tv/differentstreamer"
      );
    });

    it("should throw error if token exchange fails", async () => {
      (twitchOAuthClient.exchangeCodeForToken as jest.Mock).mockRejectedValue(
        new Error("Token exchange failed")
      );

      await expect(handleTwitchCallback(mockCode)).rejects.toThrow(
        "Token exchange failed"
      );
    });

    it("should throw error if fetching user fails", async () => {
      (twitchOAuthClient.exchangeCodeForToken as jest.Mock).mockResolvedValue(
        mockTokenResponse
      );
      (twitchOAuthClient.fetchTwitchUser as jest.Mock).mockRejectedValue(
        new Error("Failed to fetch user")
      );

      await expect(handleTwitchCallback(mockCode)).rejects.toThrow(
        "Failed to fetch user"
      );
    });
  });
});

