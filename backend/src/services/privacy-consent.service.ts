/**
 * Privacy Consent Service
 * 管理觀眾的細粒度隱私同意設定
 *
 * Story 2.5: 觀眾隱私與授權控制
 */

import { prisma } from "../db/prisma";
import type { ViewerPrivacyConsent, Prisma } from "@prisma/client";

// 隱私設定類別
export type PrivacyCategory =
  | "dailyWatchTime"
  | "watchTimeDistribution"
  | "monthlyAggregates"
  | "chatMessages"
  | "interactions"
  | "interactionFrequency"
  | "badgeProgress"
  | "footprintData"
  | "rankings"
  | "radarAnalysis";

// 隱私設定更新 DTO
export interface PrivacySettingsUpdate {
  collectDailyWatchTime?: boolean;
  collectWatchTimeDistribution?: boolean;
  collectMonthlyAggregates?: boolean;
  collectChatMessages?: boolean;
  collectInteractions?: boolean;
  collectInteractionFrequency?: boolean;
  collectBadgeProgress?: boolean;
  collectFootprintData?: boolean;
  collectRankings?: boolean;
  collectRadarAnalysis?: boolean;
}

// 類別與欄位對照表
const categoryFieldMap: Record<PrivacyCategory, keyof PrivacySettingsUpdate> = {
  dailyWatchTime: "collectDailyWatchTime",
  watchTimeDistribution: "collectWatchTimeDistribution",
  monthlyAggregates: "collectMonthlyAggregates",
  chatMessages: "collectChatMessages",
  interactions: "collectInteractions",
  interactionFrequency: "collectInteractionFrequency",
  badgeProgress: "collectBadgeProgress",
  footprintData: "collectFootprintData",
  rankings: "collectRankings",
  radarAnalysis: "collectRadarAnalysis",
};

export class PrivacyConsentService {
  /**
   * 為觀眾建立預設的隱私同意設定
   * 首次登入時呼叫，所有收集項目預設為啟用 (Opt-Out 模式)
   */
  async createDefaultConsent(viewerId: string): Promise<ViewerPrivacyConsent> {
    // 檢查是否已存在
    const existing = await prisma.viewerPrivacyConsent.findUnique({
      where: { viewerId },
    });

    if (existing) {
      return existing;
    }

    // 建立預設同意 (全部啟用)
    return prisma.viewerPrivacyConsent.create({
      data: {
        viewerId,
        consentVersion: "v1.0",
        // 所有欄位使用 Prisma schema 中的預設值 (true)
      },
    });
  }

  /**
   * 獲取觀眾的隱私同意設定
   */
  async getConsent(viewerId: string): Promise<ViewerPrivacyConsent | null> {
    return prisma.viewerPrivacyConsent.findUnique({
      where: { viewerId },
    });
  }

  /**
   * 更新觀眾的隱私同意設定
   */
  async updateConsent(
    viewerId: string,
    settings: PrivacySettingsUpdate
  ): Promise<ViewerPrivacyConsent> {
    // 確保同意記錄存在
    const existing = await this.getConsent(viewerId);
    if (!existing) {
      // 若不存在，先建立預設再更新
      await this.createDefaultConsent(viewerId);
    }

    return prisma.viewerPrivacyConsent.update({
      where: { viewerId },
      data: {
        ...settings,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * 檢查特定類別是否同意收集
   */
  async checkConsent(
    viewerId: string,
    category: PrivacyCategory
  ): Promise<boolean> {
    const consent = await this.getConsent(viewerId);

    // 若無設定，預設為同意（Opt-Out 模式）
    if (!consent) {
      return true;
    }

    const fieldName = categoryFieldMap[category];
    return consent[fieldName] as boolean;
  }

  /**
   * 批量檢查多個類別的同意狀態
   */
  async checkConsentBatch(
    viewerId: string,
    categories: PrivacyCategory[]
  ): Promise<Record<PrivacyCategory, boolean>> {
    const consent = await this.getConsent(viewerId);

    const result: Record<PrivacyCategory, boolean> = {} as Record<
      PrivacyCategory,
      boolean
    >;

    for (const category of categories) {
      if (!consent) {
        result[category] = true; // 預設同意
      } else {
        const fieldName = categoryFieldMap[category];
        result[category] = consent[fieldName] as boolean;
      }
    }

    return result;
  }

  /**
   * 獲取所有類別的同意狀態（用於前端顯示）
   */
  async getAllConsentStatus(
    viewerId: string
  ): Promise<PrivacySettingsUpdate & { consentVersion: string }> {
    const consent = await this.getConsent(viewerId);

    if (!consent) {
      // 返回預設值（全部啟用）
      return {
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
      };
    }

    return {
      consentVersion: consent.consentVersion,
      collectDailyWatchTime: consent.collectDailyWatchTime,
      collectWatchTimeDistribution: consent.collectWatchTimeDistribution,
      collectMonthlyAggregates: consent.collectMonthlyAggregates,
      collectChatMessages: consent.collectChatMessages,
      collectInteractions: consent.collectInteractions,
      collectInteractionFrequency: consent.collectInteractionFrequency,
      collectBadgeProgress: consent.collectBadgeProgress,
      collectFootprintData: consent.collectFootprintData,
      collectRankings: consent.collectRankings,
      collectRadarAnalysis: consent.collectRadarAnalysis,
    };
  }
}

// 匯出單例
export const privacyConsentService = new PrivacyConsentService();
