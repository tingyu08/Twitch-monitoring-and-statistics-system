jest.mock("../../db/prisma", () => ({
  prisma: {
    viewerPrivacyConsent: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { prisma } from "../../db/prisma";
import { PrivacyConsentService } from "../privacy-consent.service";

describe("PrivacyConsentService", () => {
  const viewerId = "viewer-1";
  let service: PrivacyConsentService;

  const consentRow = {
    viewerId,
    consentVersion: "v1.0",
    collectDailyWatchTime: true,
    collectWatchTimeDistribution: false,
    collectMonthlyAggregates: true,
    collectChatMessages: false,
    collectInteractions: true,
    collectInteractionFrequency: false,
    collectBadgeProgress: true,
    collectFootprintData: false,
    collectRankings: true,
    collectRadarAnalysis: false,
    updatedAt: new Date("2026-02-26T10:00:00.000Z"),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PrivacyConsentService();
  });

  it("createDefaultConsent returns existing row if found", async () => {
    (prisma.viewerPrivacyConsent.findUnique as jest.Mock).mockResolvedValueOnce(consentRow);

    const result = await service.createDefaultConsent(viewerId);

    expect(result).toEqual(consentRow);
    expect(prisma.viewerPrivacyConsent.create).not.toHaveBeenCalled();
  });

  it("createDefaultConsent creates default row when missing", async () => {
    (prisma.viewerPrivacyConsent.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.viewerPrivacyConsent.create as jest.Mock).mockResolvedValueOnce(consentRow);

    const result = await service.createDefaultConsent(viewerId);

    expect(result).toEqual(consentRow);
    expect(prisma.viewerPrivacyConsent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          viewerId,
          consentVersion: "v1.0",
        },
      })
    );
  });

  it("getConsent proxies findUnique", async () => {
    (prisma.viewerPrivacyConsent.findUnique as jest.Mock).mockResolvedValueOnce(consentRow);

    const result = await service.getConsent(viewerId);

    expect(result).toEqual(consentRow);
    expect(prisma.viewerPrivacyConsent.findUnique).toHaveBeenCalledWith({ where: { viewerId } });
  });

  it("updateConsent updates existing consent directly", async () => {
    (prisma.viewerPrivacyConsent.findUnique as jest.Mock).mockResolvedValueOnce(consentRow);
    (prisma.viewerPrivacyConsent.update as jest.Mock).mockResolvedValueOnce({
      ...consentRow,
      collectChatMessages: true,
    });

    const result = await service.updateConsent(viewerId, { collectChatMessages: true });

    expect(result.collectChatMessages).toBe(true);
    expect(prisma.viewerPrivacyConsent.create).not.toHaveBeenCalled();
    expect(prisma.viewerPrivacyConsent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { viewerId },
        data: expect.objectContaining({ collectChatMessages: true }),
      })
    );
  });

  it("updateConsent creates defaults first when consent missing", async () => {
    (prisma.viewerPrivacyConsent.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    (prisma.viewerPrivacyConsent.create as jest.Mock).mockResolvedValueOnce(consentRow);
    (prisma.viewerPrivacyConsent.update as jest.Mock).mockResolvedValueOnce({
      ...consentRow,
      collectRankings: false,
    });

    const result = await service.updateConsent(viewerId, { collectRankings: false });

    expect(result.collectRankings).toBe(false);
    expect(prisma.viewerPrivacyConsent.create).toHaveBeenCalledTimes(1);
    expect(prisma.viewerPrivacyConsent.update).toHaveBeenCalledTimes(1);
  });

  it("checkConsent returns true by default when consent is missing", async () => {
    (prisma.viewerPrivacyConsent.findUnique as jest.Mock).mockResolvedValueOnce(null);

    await expect(service.checkConsent(viewerId, "chatMessages")).resolves.toBe(true);
  });

  it("checkConsent returns mapped field value when consent exists", async () => {
    (prisma.viewerPrivacyConsent.findUnique as jest.Mock).mockResolvedValueOnce(consentRow);

    await expect(service.checkConsent(viewerId, "chatMessages")).resolves.toBe(false);
    await expect(service.checkConsent(viewerId, "dailyWatchTime")).resolves.toBe(true);
  });

  it("checkConsentBatch returns defaults when consent is missing", async () => {
    (prisma.viewerPrivacyConsent.findUnique as jest.Mock).mockResolvedValueOnce(null);

    const result = await service.checkConsentBatch(viewerId, ["chatMessages", "rankings"]);

    expect(result).toEqual({
      chatMessages: true,
      rankings: true,
    });
  });

  it("checkConsentBatch maps consent fields per category", async () => {
    (prisma.viewerPrivacyConsent.findUnique as jest.Mock).mockResolvedValueOnce(consentRow);

    const result = await service.checkConsentBatch(viewerId, [
      "chatMessages",
      "rankings",
      "radarAnalysis",
    ]);

    expect(result).toEqual({
      chatMessages: false,
      rankings: true,
      radarAnalysis: false,
    });
  });

  it("getAllConsentStatus returns all-enabled defaults when missing", async () => {
    (prisma.viewerPrivacyConsent.findUnique as jest.Mock).mockResolvedValueOnce(null);

    const result = await service.getAllConsentStatus(viewerId);

    expect(result).toEqual({
      consentVersion: "v1.0",
      collectDailyWatchTime: true,
      collectWatchTimeDistribution: true,
      collectMonthlyAggregates: true,
      collectChatMessages: true,
      collectInteractions: true,
      collectInteractionFrequency: true,
      collectBadgeProgress: true,
      collectFootprintData: true,
      collectRankings: true,
      collectRadarAnalysis: true,
    });
  });

  it("getAllConsentStatus returns persisted consent values", async () => {
    (prisma.viewerPrivacyConsent.findUnique as jest.Mock).mockResolvedValueOnce(consentRow);

    const result = await service.getAllConsentStatus(viewerId);

    expect(result).toEqual({
      consentVersion: "v1.0",
      collectDailyWatchTime: true,
      collectWatchTimeDistribution: false,
      collectMonthlyAggregates: true,
      collectChatMessages: false,
      collectInteractions: true,
      collectInteractionFrequency: false,
      collectBadgeProgress: true,
      collectFootprintData: false,
      collectRankings: true,
      collectRadarAnalysis: false,
    });
  });
});
