import axios from "axios";
import { TwitchOAuthClient, exchangeCodeForToken, fetchTwitchUser } from "../twitch-oauth.client";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("TwitchOAuthClient", () => {
  let client: TwitchOAuthClient;

  beforeEach(() => {
    client = new TwitchOAuthClient();
    jest.clearAllMocks();
    // Default mock for axios.isAxiosError
    (axios.isAxiosError as unknown as jest.Mock).mockImplementation(
      (payload) => payload?.isAxiosError === true
    );
  });

  describe("getOAuthUrl", () => {
    it("should return correct URL with default scopes", () => {
      const url = client.getOAuthUrl("state123");
      expect(url).toContain("client_id=");
      expect(url).toContain("redirect_uri=");
      expect(url).toContain("state=state123");
      expect(url).toContain("scope=user%3Aread%3Aemail");
    });

    it("should support custom scopes and redirect URI", () => {
      const url = client.getOAuthUrl("s", {
        redirectUri: "http://test",
        scopes: ["chat:read"],
      });
      expect(url).toContain("redirect_uri=http%3A%2F%2Ftest");
      expect(url).toContain("scope=chat%3Aread");
    });
  });

  describe("getAccessToken", () => {
    it("should call twitch token endpoint", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: "at", refresh_token: "rt", expires_in: 3600 },
      });

      const res = await client.getAccessToken("code123");
      expect(res.access_token).toBe("at");
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it("should throw error on failure", async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error("Failed"));
      await expect(client.getAccessToken("c")).rejects.toThrow();
    });
  });

  describe("getUserInfo", () => {
    it("should fetch user info from twitch", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { data: [{ id: "123", login: "test", display_name: "Test" }] },
      });

      const user = await client.getUserInfo("token");
      expect(user.id).toBe("123");
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining("/users"),
        expect.any(Object)
      );
    });

    it("should return undefined if no user data", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { data: [] } });
      const user = await client.getUserInfo("t");
      expect(user).toBeUndefined();
    });
  });

  describe("getBroadcasterSubscriptions", () => {
    it("should aggregate subscription tiers", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          total: 3,
          data: [{ tier: "1000" }, { tier: "2000" }, { tier: "3000" }],
          pagination: {},
        },
      });

      const res = await client.getBroadcasterSubscriptions("at", "bid");
      expect(res.total).toBe(3);
      expect(res.byTier.tier1).toBe(1);
      expect(res.byTier.tier2).toBe(1);
      expect(res.byTier.tier3).toBe(1);
    });

    it("should handle 401 Unauthorized", async () => {
      (axios.get as jest.Mock).mockRejectedValue({
        isAxiosError: true,
        response: { status: 401 },
      });
      await expect(client.getBroadcasterSubscriptions("at", "id")).rejects.toThrow(/Unauthorized/);
    });

    it("should handle 403 Forbidden", async () => {
      (axios.get as jest.Mock).mockRejectedValue({
        isAxiosError: true,
        response: { status: 403 },
      });
      await expect(client.getBroadcasterSubscriptions("at", "id")).rejects.toThrow(/Forbidden/);
    });

    it("should handle 429 Rate Limit", async () => {
      (axios.get as jest.Mock).mockRejectedValue({
        isAxiosError: true,
        response: { status: 429 },
      });
      await expect(client.getBroadcasterSubscriptions("at", "id")).rejects.toThrow(/Rate limit/);
    });

    it("should handle generic errors", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Network Error"));
      await expect(client.getBroadcasterSubscriptions("at", "id")).rejects.toThrow(/Failed to get/);
    });
  });
});

describe("TwitchOAuthClient Exported Functions", () => {
  it("should export exchangeCodeForToken wrapper", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        access_token: "at_wrap",
        refresh_token: "rt_wrap",
        expires_in: 3600,
      },
    });

    const res = await exchangeCodeForToken("code");
    expect(res.access_token).toBe("at_wrap");
  });

  it("should export fetchTwitchUser wrapper", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { data: [{ id: "wrap_u", login: "wrap", display_name: "Wrap" }] },
    });

    const user = await fetchTwitchUser("at");
    expect(user.id).toBe("wrap_u");
  });
});
