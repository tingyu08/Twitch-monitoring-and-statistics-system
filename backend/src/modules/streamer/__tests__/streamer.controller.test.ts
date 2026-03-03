import type { Request, Response } from "express";
import * as StreamerController from "../streamer.controller";
import * as StreamerService from "../streamer.service";
import * as SubService from "../subscription-sync.service";
import type { AuthRequest } from "../../auth/auth.middleware";
import type { JWTPayload } from "../../auth/jwt.utils";

jest.mock("../streamer.service");
jest.mock("../subscription-sync.service");

describe("StreamerController", () => {
  let mockReq: Partial<AuthRequest>;
  let mockRes: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    mockReq = {
      user: { streamerId: "s1" } as unknown as JWTPayload,
      query: {},
      params: {},
    };
    mockRes = {
      status: statusMock,
      json: jsonMock,
    } as unknown as Response;
    jest.clearAllMocks();
  });

  describe("getSummaryHandler", () => {
    it("should return summary for valid range", async () => {
      mockReq.query = { range: "30d" };
      (StreamerService.getStreamerSummary as jest.Mock).mockResolvedValue({
        total: 10,
      });
      await StreamerController.getSummaryHandler(mockReq as AuthRequest, mockRes as Response);
      expect(StreamerService.getStreamerSummary).toHaveBeenCalledWith("s1", "30d");
      expect(jsonMock).toHaveBeenCalledWith({ total: 10 });
    });

    it("should use default range when missing", async () => {
      (StreamerService.getStreamerSummary as jest.Mock).mockResolvedValue({ total: 99 });
      await StreamerController.getSummaryHandler(mockReq as AuthRequest, mockRes as Response);
      expect(StreamerService.getStreamerSummary).toHaveBeenCalledWith("s1", "30d");
      expect(jsonMock).toHaveBeenCalledWith({ total: 99 });
    });

    it("should 400 for invalid range", async () => {
      mockReq.query = { range: "invalid" };
      await StreamerController.getSummaryHandler(mockReq as AuthRequest, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "Invalid range parameter. Use 7d, 30d, or 90d.",
      });
    });

    it("should 401 if no streamerId", async () => {
      mockReq.user = undefined;
      await StreamerController.getSummaryHandler(mockReq as AuthRequest, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Unauthorized" });
    });

    it("should 500 on error", async () => {
      (StreamerService.getStreamerSummary as jest.Mock).mockRejectedValue(new Error("err"));
      await StreamerController.getSummaryHandler(mockReq as AuthRequest, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Internal Server Error" });
    });
  });

  describe("getStreamerSummaryByIdHandler", () => {
    it("should return summary by ID", async () => {
      mockReq.params = { streamerId: "s2" };
      (StreamerService.getStreamerSummary as jest.Mock).mockResolvedValue({
        id: "s2",
      });
      await StreamerController.getStreamerSummaryByIdHandler(
        mockReq as Request,
        mockRes as Response
      );
      expect(StreamerService.getStreamerSummary).toHaveBeenCalledWith("s2", "30d");
      expect(jsonMock).toHaveBeenCalledWith({ id: "s2" });
    });

    it("should 400 if streamerId missing", async () => {
      mockReq.params = { streamerId: "" };
      await StreamerController.getStreamerSummaryByIdHandler(
        mockReq as Request,
        mockRes as Response
      );
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error: "streamerId is required" });
    });

    it("should 400 for invalid range", async () => {
      mockReq.params = { streamerId: "s1" };
      mockReq.query = { range: "invalid" };
      await StreamerController.getStreamerSummaryByIdHandler(
        mockReq as Request,
        mockRes as Response
      );
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "Invalid range parameter. Use 7d, 30d, or 90d.",
      });
    });

    it("should return 500 when service throws", async () => {
      mockReq.params = { streamerId: "s2" };
      (StreamerService.getStreamerSummary as jest.Mock).mockRejectedValue(new Error("boom"));
      await StreamerController.getStreamerSummaryByIdHandler(mockReq as Request, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Internal Server Error" });
    });
  });

  describe("getTimeSeriesHandler", () => {
    it("should return time series", async () => {
      mockReq.query = { range: "30d", granularity: "day" };
      (StreamerService.getStreamerTimeSeries as jest.Mock).mockResolvedValue([]);
      await StreamerController.getTimeSeriesHandler(mockReq as AuthRequest, mockRes as Response);
      expect(StreamerService.getStreamerTimeSeries).toHaveBeenCalledWith("s1", "30d", "day");
      expect(jsonMock).toHaveBeenCalledWith([]);
    });

    it("should use default range and granularity when missing", async () => {
      (StreamerService.getStreamerTimeSeries as jest.Mock).mockResolvedValue([]);
      await StreamerController.getTimeSeriesHandler(mockReq as AuthRequest, mockRes as Response);
      expect(StreamerService.getStreamerTimeSeries).toHaveBeenCalledWith("s1", "30d", "day");
      expect(jsonMock).toHaveBeenCalledWith([]);
    });

    it("should 401 if no streamerId", async () => {
      mockReq.user = undefined;
      await StreamerController.getTimeSeriesHandler(mockReq as AuthRequest, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Unauthorized" });
    });

    it("should 400 for invalid range", async () => {
      mockReq.query = { range: "invalid", granularity: "day" };
      await StreamerController.getTimeSeriesHandler(mockReq as AuthRequest, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "Invalid range parameter. Use 7d, 30d, or 90d.",
      });
    });

    it("should 400 for invalid granularity", async () => {
      mockReq.query = { granularity: "invalid" };
      await StreamerController.getTimeSeriesHandler(mockReq as AuthRequest, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "Invalid granularity parameter. Use day or week.",
      });
    });

    it("should 500 on service error", async () => {
      (StreamerService.getStreamerTimeSeries as jest.Mock).mockRejectedValue(new Error("err"));
      await StreamerController.getTimeSeriesHandler(mockReq as AuthRequest, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Internal Server Error" });
    });
  });

  describe("getHeatmapHandler", () => {
    it("should return heatmap", async () => {
      (StreamerService.getStreamerHeatmap as jest.Mock).mockResolvedValue({});
      await StreamerController.getHeatmapHandler(mockReq as AuthRequest, mockRes as Response);
      expect(StreamerService.getStreamerHeatmap).toHaveBeenCalledWith("s1", "30d");
      expect(jsonMock).toHaveBeenCalledWith({});
    });

    it("should 401 if no streamerId", async () => {
      mockReq.user = undefined;
      await StreamerController.getHeatmapHandler(mockReq as AuthRequest, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Unauthorized" });
    });

    it("should 400 for invalid range", async () => {
      mockReq.query = { range: "oops" };
      await StreamerController.getHeatmapHandler(mockReq as AuthRequest, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "Invalid range parameter. Use 7d, 30d, or 90d.",
      });
    });

    it("should 500 on service error", async () => {
      (StreamerService.getStreamerHeatmap as jest.Mock).mockRejectedValue(new Error("err"));
      await StreamerController.getHeatmapHandler(mockReq as AuthRequest, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Internal Server Error" });
    });
  });

  describe("getSubscriptionTrendHandler", () => {
    it("should return subscription trend", async () => {
      (SubService.getSubscriptionTrend as jest.Mock).mockResolvedValue([]);
      await StreamerController.getSubscriptionTrendHandler(
        mockReq as AuthRequest,
        mockRes as Response
      );
      expect(SubService.getSubscriptionTrend).toHaveBeenCalledWith("s1", "30d");
      expect(jsonMock).toHaveBeenCalledWith([]);
    });

    it("should 401 if no streamerId", async () => {
      mockReq.user = undefined;
      await StreamerController.getSubscriptionTrendHandler(
        mockReq as AuthRequest,
        mockRes as Response
      );
      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Unauthorized" });
    });

    it("should 400 for invalid range", async () => {
      mockReq.query = { range: "invalid" };
      await StreamerController.getSubscriptionTrendHandler(
        mockReq as AuthRequest,
        mockRes as Response
      );
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "Invalid range parameter. Use 7d, 30d, or 90d.",
      });
    });

    it("should 500 on service error", async () => {
      (SubService.getSubscriptionTrend as jest.Mock).mockRejectedValue(new Error("err"));
      await StreamerController.getSubscriptionTrendHandler(
        mockReq as AuthRequest,
        mockRes as Response
      );
      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Internal Server Error" });
    });
  });

  describe("syncSubscriptionsHandler", () => {
    it("should sync successfully", async () => {
      (SubService.syncSubscriptionSnapshot as jest.Mock).mockResolvedValue(undefined);
      await StreamerController.syncSubscriptionsHandler(mockReq as AuthRequest, mockRes as Response);
      expect(SubService.syncSubscriptionSnapshot).toHaveBeenCalledWith("s1");
      expect(jsonMock).toHaveBeenCalledWith({ message: "Subscription data synced successfully" });
    });

    it("should 401 if no streamerId", async () => {
      mockReq.user = undefined;
      await StreamerController.syncSubscriptionsHandler(mockReq as AuthRequest, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Unauthorized" });
    });

    it("should handle error with specific messages", async () => {
      const errorPairs = [
        { msg: "No channel found", status: 404 },
        { msg: "No Twitch token found", status: 401 },
        { msg: "Unauthorized", status: 403 },
        { msg: "Forbidden", status: 403 },
        { msg: "Other", status: 500 },
      ];

      for (const pair of errorPairs) {
        (SubService.syncSubscriptionSnapshot as jest.Mock).mockRejectedValueOnce(
          new Error(pair.msg)
        );
        await StreamerController.syncSubscriptionsHandler(
          mockReq as AuthRequest,
          mockRes as Response
        );
        expect(statusMock).toHaveBeenLastCalledWith(pair.status);
      }
    });

    it("should handle non-error objects gracefully", async () => {
      (SubService.syncSubscriptionSnapshot as jest.Mock).mockRejectedValueOnce("String error");
      await StreamerController.syncSubscriptionsHandler(
        mockReq as AuthRequest,
        mockRes as Response
      );
      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });
});
