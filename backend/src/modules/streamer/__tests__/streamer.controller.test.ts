import { Response, Request } from "express";
import * as StreamerController from "../streamer.controller";
import * as StreamerService from "../streamer.service";
import * as SubService from "../subscription-sync.service";
import { AuthRequest } from "../../auth/auth.middleware";
import { JWTPayload } from "../../auth/jwt.utils";

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
      await StreamerController.getSummaryHandler(
        mockReq as AuthRequest,
        mockRes as Response
      );
      expect(jsonMock).toHaveBeenCalledWith({ total: 10 });
    });

    it("should 400 for invalid range", async () => {
      mockReq.query = { range: "invalid" };
      await StreamerController.getSummaryHandler(
        mockReq as AuthRequest,
        mockRes as Response
      );
      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it("should 401 if no streamerId", async () => {
      mockReq.user = undefined;
      await StreamerController.getSummaryHandler(
        mockReq as AuthRequest,
        mockRes as Response
      );
      expect(statusMock).toHaveBeenCalledWith(401);
    });

    it("should 500 on error", async () => {
      (StreamerService.getStreamerSummary as jest.Mock).mockRejectedValue(
        new Error("err")
      );
      await StreamerController.getSummaryHandler(
        mockReq as AuthRequest,
        mockRes as Response
      );
      expect(statusMock).toHaveBeenCalledWith(500);
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
      expect(jsonMock).toHaveBeenCalledWith({ id: "s2" });
    });

    it("should 400 if streamerId missing", async () => {
      mockReq.params = { streamerId: "" };
      await StreamerController.getStreamerSummaryByIdHandler(
        mockReq as Request,
        mockRes as Response
      );
      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it("should 400 for invalid range", async () => {
      mockReq.params = { streamerId: "s1" };
      mockReq.query = { range: "invalid" };
      await StreamerController.getStreamerSummaryByIdHandler(
        mockReq as Request,
        mockRes as Response
      );
      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });

  describe("getTimeSeriesHandler", () => {
    it("should return time series", async () => {
      mockReq.query = { range: "30d", granularity: "day" };
      (StreamerService.getStreamerTimeSeries as jest.Mock).mockResolvedValue(
        []
      );
      await StreamerController.getTimeSeriesHandler(
        mockReq as AuthRequest,
        mockRes as Response
      );
      expect(jsonMock).toHaveBeenCalled();
    });

    it("should 400 for invalid granularity", async () => {
      mockReq.query = { granularity: "invalid" };
      await StreamerController.getTimeSeriesHandler(
        mockReq as AuthRequest,
        mockRes as Response
      );
      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });

  describe("getHeatmapHandler", () => {
    it("should return heatmap", async () => {
      (StreamerService.getStreamerHeatmap as jest.Mock).mockResolvedValue({});
      await StreamerController.getHeatmapHandler(
        mockReq as AuthRequest,
        mockRes as Response
      );
      expect(jsonMock).toHaveBeenCalled();
    });
  });

  describe("getSubscriptionTrendHandler", () => {
    it("should return subscription trend", async () => {
      (SubService.getSubscriptionTrend as jest.Mock).mockResolvedValue([]);
      await StreamerController.getSubscriptionTrendHandler(
        mockReq as AuthRequest,
        mockRes as Response
      );
      expect(jsonMock).toHaveBeenCalled();
    });
  });

  describe("syncSubscriptionsHandler", () => {
    it("should handle error with specific messages", async () => {
      const errorPairs = [
        { msg: "No channel found", status: 404 },
        { msg: "No Twitch token found", status: 401 },
        { msg: "Unauthorized", status: 403 },
        { msg: "Forbidden", status: 403 },
        { msg: "Other", status: 500 },
      ];

      for (const pair of errorPairs) {
        (
          SubService.syncSubscriptionSnapshot as jest.Mock
        ).mockRejectedValueOnce(new Error(pair.msg));
        await StreamerController.syncSubscriptionsHandler(
          mockReq as AuthRequest,
          mockRes as Response
        );
        expect(statusMock).toHaveBeenLastCalledWith(pair.status);
      }
    });

    it("should handle non-error objects gracefully", async () => {
      (SubService.syncSubscriptionSnapshot as jest.Mock).mockRejectedValueOnce(
        "String error"
      );
      await StreamerController.syncSubscriptionsHandler(
        mockReq as AuthRequest,
        mockRes as Response
      );
      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });
});
