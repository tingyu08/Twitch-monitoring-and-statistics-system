import crypto from "crypto";
import { verifyEventSubSignature, EVENTSUB_MESSAGE_TYPE } from "../eventsub.middleware";
import type { Request, Response, NextFunction } from "express";

jest.mock("../../utils/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const SECRET = "test-eventsub-secret";

const makeReqResNext = (overrides: Partial<{
  messageId: string;
  timestamp: string;
  signature: string;
  messageType: string;
  rawBody: string;
  body: unknown;
}> = {}) => {
  const messageId = overrides.messageId ?? "msg-123";
  const timestamp = overrides.timestamp ?? new Date().toISOString();
  const rawBody = overrides.rawBody ?? '{"event":"test"}';
  const body = overrides.body ?? { event: "test" };
  const signature = overrides.signature ?? computeValidSignature(messageId, timestamp, rawBody);
  const messageType = overrides.messageType ?? "notification";

  const req: any = {
    headers: {
      "twitch-eventsub-message-id": messageId,
      "twitch-eventsub-message-timestamp": timestamp,
      "twitch-eventsub-message-signature": signature,
      "twitch-eventsub-message-type": messageType,
    },
    rawBody,
    body,
  };
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
};

function computeValidSignature(messageId: string, timestamp: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", SECRET).update(messageId + timestamp + body).digest("hex");
}

describe("verifyEventSubSignature", () => {
  beforeEach(() => {
    process.env.EVENTSUB_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.EVENTSUB_SECRET;
  });

  it("should call next() for valid signature", () => {
    const { req, res, next } = makeReqResNext();
    verifyEventSubSignature(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should attach eventsubMessageType to request", () => {
    const { req, res, next } = makeReqResNext({ messageType: "webhook_callback_verification" });
    verifyEventSubSignature(req, res, next);
    expect(req.eventsubMessageType).toBe("webhook_callback_verification");
  });

  it("should return 403 when messageId is missing", () => {
    const { req, res, next } = makeReqResNext();
    delete req.headers["twitch-eventsub-message-id"];
    verifyEventSubSignature(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing required headers" });
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 403 when timestamp is missing", () => {
    const { req, res, next } = makeReqResNext();
    delete req.headers["twitch-eventsub-message-timestamp"];
    verifyEventSubSignature(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 403 when signature is missing", () => {
    const { req, res, next } = makeReqResNext();
    delete req.headers["twitch-eventsub-message-signature"];
    verifyEventSubSignature(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 403 for expired timestamp", () => {
    const oldTimestamp = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { req, res, next } = makeReqResNext({ timestamp: oldTimestamp });
    verifyEventSubSignature(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Timestamp expired" });
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 403 for invalid signature", () => {
    const { req, res, next } = makeReqResNext({ signature: "sha256=invalidsignature" });
    verifyEventSubSignature(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid signature" });
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 500 when EVENTSUB_SECRET is not set", () => {
    delete process.env.EVENTSUB_SECRET;
    const { req, res, next } = makeReqResNext();
    verifyEventSubSignature(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  it("should use req.body JSON when rawBody is absent", () => {
    const messageId = "msg-456";
    const timestamp = new Date().toISOString();
    const bodyObj = { event: "channel.update" };
    const rawBodyStr = JSON.stringify(bodyObj);
    const signature = computeValidSignature(messageId, timestamp, rawBodyStr);

    const req: any = {
      headers: {
        "twitch-eventsub-message-id": messageId,
        "twitch-eventsub-message-timestamp": timestamp,
        "twitch-eventsub-message-signature": signature,
        "twitch-eventsub-message-type": "notification",
      },
      // No rawBody property
      body: bodyObj,
    };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();

    verifyEventSubSignature(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should use string body directly when rawBody is absent and body is string", () => {
    const messageId = "msg-789";
    const timestamp = new Date().toISOString();
    const bodyStr = '{"event":"sub"}';
    const signature = computeValidSignature(messageId, timestamp, bodyStr);

    const req: any = {
      headers: {
        "twitch-eventsub-message-id": messageId,
        "twitch-eventsub-message-timestamp": timestamp,
        "twitch-eventsub-message-signature": signature,
        "twitch-eventsub-message-type": "notification",
      },
      body: bodyStr,
    };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();

    verifyEventSubSignature(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe("EVENTSUB_MESSAGE_TYPE", () => {
  it("should have correct constants", () => {
    expect(EVENTSUB_MESSAGE_TYPE.NOTIFICATION).toBe("notification");
    expect(EVENTSUB_MESSAGE_TYPE.VERIFICATION).toBe("webhook_callback_verification");
    expect(EVENTSUB_MESSAGE_TYPE.REVOCATION).toBe("revocation");
  });
});
