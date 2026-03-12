/**
 * eventsub.routes.ts 測試
 */

jest.mock("../../middleware/eventsub.middleware", () => ({
  verifyEventSubSignature: jest.fn((_req, _res, next) => next()),
  EVENTSUB_MESSAGE_TYPE: {
    NOTIFICATION: "notification",
    VERIFICATION: "webhook_callback_verification",
    REVOCATION: "revocation",
  },
}));

jest.mock("../../services/eventsub.service", () => ({
  eventSubService: {
    handleStreamOnline: jest.fn().mockResolvedValue(undefined),
    handleStreamOffline: jest.fn().mockResolvedValue(undefined),
    handleChannelUpdate: jest.fn().mockResolvedValue(undefined),
    handleSubscription: jest.fn().mockResolvedValue(undefined),
    handleCheer: jest.fn().mockResolvedValue(undefined),
  },
  EVENTSUB_TYPES: {
    STREAM_ONLINE: "stream.online",
    STREAM_OFFLINE: "stream.offline",
    CHANNEL_UPDATE: "channel.update",
    CHANNEL_SUBSCRIBE: "channel.subscribe",
    CHANNEL_SUBSCRIPTION_MESSAGE: "channel.subscription.message",
    CHANNEL_CHEER: "channel.cheer",
  },
}));

jest.mock("../../services/twurple-eventsub.service", () => ({
  twurpleEventSubService: {
    getStatus: jest.fn().mockReturnValue({ initialized: false }),
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import request from "supertest";
import express from "express";
import { eventSubRoutes } from "../eventsub.routes";
import { verifyEventSubSignature } from "../../middleware/eventsub.middleware";
import { eventSubService } from "../../services/eventsub.service";
import { twurpleEventSubService } from "../../services/twurple-eventsub.service";

const app = express();
app.use(express.json());
app.use("/eventsub", eventSubRoutes);

// removed makeEventSubMiddleware

describe("EventSub Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // GET /eventsub/status
  // ============================================================
  describe("GET /eventsub/status", () => {
    it("returns service status", async () => {
      process.env.EVENTSUB_ENABLED = "true";
      process.env.EVENTSUB_CALLBACK_URL = "https://example.com/eventsub";
      (twurpleEventSubService.getStatus as jest.Mock).mockReturnValue({ initialized: true });

      const res = await request(app).get("/eventsub/status");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("initialized");
      expect(res.body).toHaveProperty("enabled");

      delete process.env.EVENTSUB_ENABLED;
      delete process.env.EVENTSUB_CALLBACK_URL;
    });
  });

  // ============================================================
  // POST /eventsub/callback – verification
  // ============================================================
  describe("POST /eventsub/callback – challenge verification", () => {
    it("responds with challenge string", async () => {
      (verifyEventSubSignature as jest.Mock).mockImplementationOnce(
        (req: any, _res: any, next: any) => {
          req.eventsubMessageType = "webhook_callback_verification";
          next();
        }
      );

      const res = await request(app)
        .post("/eventsub/callback")
        .send({ challenge: "test-challenge" });

      expect(res.status).toBe(200);
      expect(res.text).toBe("test-challenge");
    });
  });

  // ============================================================
  // POST /eventsub/callback – revocation
  // ============================================================
  describe("POST /eventsub/callback – revocation", () => {
    it("returns 204 on revocation", async () => {
      (verifyEventSubSignature as jest.Mock).mockImplementationOnce(
        (req: any, _res: any, next: any) => {
          req.eventsubMessageType = "revocation";
          next();
        }
      );

      const res = await request(app)
        .post("/eventsub/callback")
        .send({ subscription: { type: "stream.online", status: "revoked" } });

      expect(res.status).toBe(204);
    });
  });

  // ============================================================
  // POST /eventsub/callback – notification events
  // ============================================================
  describe("POST /eventsub/callback – notifications", () => {
    function makeNotificationMiddleware(eventType: string) {
      return (req: any, _res: any, next: any) => {
        req.eventsubMessageType = "notification";
        req.body = {
          subscription: { type: eventType },
          event: { broadcaster_user_id: "123", broadcaster_user_login: "testuser" },
        };
        next();
      };
    }

    it("handles stream.online when twurple is inactive", async () => {
      (twurpleEventSubService.getStatus as jest.Mock).mockReturnValue({ initialized: false });
      (verifyEventSubSignature as jest.Mock).mockImplementationOnce(
        makeNotificationMiddleware("stream.online")
      );

      const res = await request(app).post("/eventsub/callback").send({});
      expect(res.status).toBe(204);
      expect(eventSubService.handleStreamOnline).toHaveBeenCalled();
    });

    it("skips stream.online when twurple is active", async () => {
      (twurpleEventSubService.getStatus as jest.Mock).mockReturnValue({ initialized: true });
      (verifyEventSubSignature as jest.Mock).mockImplementationOnce(
        makeNotificationMiddleware("stream.online")
      );

      const res = await request(app).post("/eventsub/callback").send({});
      expect(res.status).toBe(204);
      expect(eventSubService.handleStreamOnline).not.toHaveBeenCalled();
    });

    it("handles stream.offline when twurple is inactive", async () => {
      (twurpleEventSubService.getStatus as jest.Mock).mockReturnValue({ initialized: false });
      (verifyEventSubSignature as jest.Mock).mockImplementationOnce(
        makeNotificationMiddleware("stream.offline")
      );

      const res = await request(app).post("/eventsub/callback").send({});
      expect(res.status).toBe(204);
      expect(eventSubService.handleStreamOffline).toHaveBeenCalled();
    });

    it("skips stream.offline when twurple is active", async () => {
      (twurpleEventSubService.getStatus as jest.Mock).mockReturnValue({ initialized: true });
      (verifyEventSubSignature as jest.Mock).mockImplementationOnce(
        makeNotificationMiddleware("stream.offline")
      );

      const res = await request(app).post("/eventsub/callback").send({});
      expect(res.status).toBe(204);
      expect(eventSubService.handleStreamOffline).not.toHaveBeenCalled();
    });

    it("handles channel.update", async () => {
      (verifyEventSubSignature as jest.Mock).mockImplementationOnce(
        makeNotificationMiddleware("channel.update")
      );

      const res = await request(app).post("/eventsub/callback").send({});
      expect(res.status).toBe(204);
      expect(eventSubService.handleChannelUpdate).toHaveBeenCalled();
    });

    it("handles channel.subscribe", async () => {
      (verifyEventSubSignature as jest.Mock).mockImplementationOnce(
        makeNotificationMiddleware("channel.subscribe")
      );

      const res = await request(app).post("/eventsub/callback").send({});
      expect(res.status).toBe(204);
      expect(eventSubService.handleSubscription).toHaveBeenCalled();
    });

    it("handles channel.subscription.message", async () => {
      (verifyEventSubSignature as jest.Mock).mockImplementationOnce(
        makeNotificationMiddleware("channel.subscription.message")
      );

      const res = await request(app).post("/eventsub/callback").send({});
      expect(res.status).toBe(204);
      expect(eventSubService.handleSubscription).toHaveBeenCalled();
    });

    it("handles channel.cheer", async () => {
      (verifyEventSubSignature as jest.Mock).mockImplementationOnce(
        makeNotificationMiddleware("channel.cheer")
      );

      const res = await request(app).post("/eventsub/callback").send({});
      expect(res.status).toBe(204);
      expect(eventSubService.handleCheer).toHaveBeenCalled();
    });

    it("handles unknown event type gracefully", async () => {
      (verifyEventSubSignature as jest.Mock).mockImplementationOnce(
        makeNotificationMiddleware("unknown.event.type")
      );

      const res = await request(app).post("/eventsub/callback").send({});
      expect(res.status).toBe(204);
    });

    it("returns 500 when handler throws error", async () => {
      (twurpleEventSubService.getStatus as jest.Mock).mockReturnValue({ initialized: false });
      (verifyEventSubSignature as jest.Mock).mockImplementationOnce(
        makeNotificationMiddleware("stream.online")
      );
      (eventSubService.handleStreamOnline as jest.Mock).mockRejectedValueOnce(
        new Error("handler error")
      );

      const res = await request(app).post("/eventsub/callback").send({});
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // POST /eventsub/callback – unknown message type
  // ============================================================
  describe("POST /eventsub/callback – unknown message type", () => {
    it("returns 400 for unknown message type", async () => {
      (verifyEventSubSignature as jest.Mock).mockImplementationOnce(
        (req: any, _res: any, next: any) => {
          req.eventsubMessageType = "unknown_type";
          next();
        }
      );

      const res = await request(app).post("/eventsub/callback").send({});
      expect(res.status).toBe(400);
    });
  });
});
