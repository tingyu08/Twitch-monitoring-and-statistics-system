import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../../auth/auth.middleware";

import { requireStreamer, requireStreamerAsync } from "../streamer.middleware";

function makeReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    user: { streamerId: "streamer-1" },
    ...overrides,
  } as AuthRequest;
}

function makeRes(): Response {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;

  (res.status as jest.Mock).mockReturnValue(res);

  return res;
}

describe("streamer.middleware", () => {
  describe("requireStreamer", () => {
    it("calls next when streamerId exists", () => {
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      requireStreamer(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("returns 403 when user is missing", () => {
      const req = makeReq({ user: undefined });
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      requireStreamer(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Not a streamer" });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 403 when streamerId is empty", () => {
      const req = makeReq({ user: { streamerId: "" } as AuthRequest["user"] });
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      requireStreamer(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Not a streamer" });
      expect(next).not.toHaveBeenCalled();
    });

    it("propagates errors thrown by next", () => {
      const req = makeReq();
      const res = makeRes();
      const nextError = new Error("next failed");
      const next = jest.fn(() => {
        throw nextError;
      }) as NextFunction;

      expect(() => requireStreamer(req, res, next)).toThrow("next failed");
    });
  });

  describe("requireStreamerAsync", () => {
    it("calls next when streamerId exists", async () => {
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      await requireStreamerAsync(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("returns 403 when user is missing", async () => {
      const req = makeReq({ user: undefined });
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      await requireStreamerAsync(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Not a streamer" });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 403 when streamerId is empty", async () => {
      const req = makeReq({ user: { streamerId: "" } as AuthRequest["user"] });
      const res = makeRes();
      const next = jest.fn() as NextFunction;

      await requireStreamerAsync(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Not a streamer" });
      expect(next).not.toHaveBeenCalled();
    });

    it("rejects when next throws", async () => {
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn(() => {
        throw new Error("next failed");
      }) as NextFunction;

      await expect(requireStreamerAsync(req, res, next)).rejects.toThrow("next failed");
    });
  });
});
