import request from "supertest";
import express from "express";
import { proxyRoutes } from "../proxy.routes";

// Mock axios
jest.mock("axios");
import axios from "axios";
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("Proxy Routes", () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use("/api/proxy", proxyRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/proxy/avatar", () => {
    it("should return 400 if url parameter is missing", async () => {
      const response = await request(app).get("/api/proxy/avatar");
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Missing or invalid 'url' parameter");
    });

    it("should return 400 if url parameter is not a string", async () => {
      const response = await request(app).get("/api/proxy/avatar?url=a&url=b");
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Missing or invalid 'url' parameter");
    });

    it("should return 403 for non-whitelisted domains", async () => {
      const url = encodeURIComponent("https://evil.com/image.png");
      const response = await request(app).get(`/api/proxy/avatar?url=${url}`);
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Domain not allowed");
    });

    it("should proxy Twitch CDN images successfully", async () => {
      const imageBuffer = Buffer.from("fake-image-data");
      mockedAxios.get.mockResolvedValueOnce({
        data: imageBuffer,
        headers: { "content-type": "image/png" },
      });

      const url = encodeURIComponent("https://static-cdn.jtvnw.net/avatar-123.png");
      const response = await request(app).get(`/api/proxy/avatar?url=${url}`);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("image/png");
      expect(response.headers["cache-control"]).toBe("public, max-age=86400");
      expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://static-cdn.jtvnw.net/avatar-123.png",
        expect.objectContaining({
          responseType: "arraybuffer",
          timeout: 10000,
        })
      );
    });

    it("should allow ui-avatars.com domain", async () => {
      const imageBuffer = Buffer.from("fake-avatar-data");
      mockedAxios.get.mockResolvedValueOnce({
        data: imageBuffer,
        headers: { "content-type": "image/png" },
      });

      const url = encodeURIComponent("https://ui-avatars.com/api/?name=Test&size=128");
      const response = await request(app).get(`/api/proxy/avatar?url=${url}`);

      expect(response.status).toBe(200);
    });

    it("should allow subdomains of whitelisted domains", async () => {
      const imageBuffer = Buffer.from("fake-subdomain-data");
      mockedAxios.get.mockResolvedValueOnce({
        data: imageBuffer,
        headers: { "content-type": "image/png" },
      });

      const url = encodeURIComponent("https://a.b.static-cdn.jtvnw.net/avatar-123.png");
      const response = await request(app).get(`/api/proxy/avatar?url=${url}`);

      expect(response.status).toBe(200);
    });

    it("should allow assets.twitch.tv domain", async () => {
      const imageBuffer = Buffer.from("fake-twitch-assets-data");
      mockedAxios.get.mockResolvedValueOnce({
        data: imageBuffer,
        headers: { "content-type": "image/jpeg" },
      });

      const url = encodeURIComponent("https://assets.twitch.tv/assets/logo.png");
      const response = await request(app).get(`/api/proxy/avatar?url=${url}`);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("image/jpeg");
    });

    it("should return 403 for non-https urls", async () => {
      const url = encodeURIComponent("http://static-cdn.jtvnw.net/avatar-123.png");
      const response = await request(app).get(`/api/proxy/avatar?url=${url}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Only HTTPS URLs are allowed");
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("should fallback to image/png when response content-type is missing", async () => {
      const imageBuffer = Buffer.from("fake-default-content-type-data");
      mockedAxios.get.mockResolvedValueOnce({
        data: imageBuffer,
        headers: {},
      });

      const url = encodeURIComponent("https://static-cdn.jtvnw.net/avatar-123.png");
      const response = await request(app).get(`/api/proxy/avatar?url=${url}`);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("image/png");
    });

    it("should redirect to fallback on malformed encoded url", async () => {
      const response = await request(app).get("/api/proxy/avatar?url=%E0%A4%A");

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain("ui-avatars.com");
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("should redirect to fallback on error", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Network error"));

      const url = encodeURIComponent("https://static-cdn.jtvnw.net/avatar-123.png");
      const response = await request(app).get(`/api/proxy/avatar?url=${url}`);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain("ui-avatars.com");
    });
  });
});
