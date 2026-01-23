import request from "supertest";
import express from "express";
import crypto from "crypto";

// Correct Import Paths
// Note: We need to mock eventsub.service first
const mockEventSubService = {
  handleStreamOnline: jest.fn(),
  handleStreamOffline: jest.fn(),
  handleChannelUpdate: jest.fn(),
};

jest.mock("../../services/eventsub.service", () => ({
  eventSubService: mockEventSubService,
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { verifyEventSubSignature } from "../../middleware/eventsub.middleware";

// Initialize App for Middleware Testing
const app = express();
app.use(
  express.json({
    verify: (req: any, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.post("/eventsub/callback", verifyEventSubSignature, (req, res) => res.status(200).send("OK"));

describe("Story 3.3: EventSub Middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EVENTSUB_SECRET = "test_secret";
  });

  it("should reject request with missing signature", async () => {
    const res = await request(app).post("/eventsub/callback").send({ some: "data" });
    expect(res.status).toBe(403);
  });

  it("should accept request with valid signature", async () => {
    const secret = "test_secret";
    const messageId = "test-id";
    const timestamp = new Date().toISOString();
    const body = JSON.stringify({ subscription: { type: "stream.online" } });

    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(messageId + timestamp + body);
    const signature = `sha256=${hmac.digest("hex")}`;

    const res = await request(app)
      .post("/eventsub/callback")
      .set("Twitch-Eventsub-Message-Id", messageId)
      .set("Twitch-Eventsub-Message-Timestamp", timestamp)
      .set("Twitch-Eventsub-Message-Signature", signature)
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
  });
});
