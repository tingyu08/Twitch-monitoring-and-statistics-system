"use client";

import { useState } from "react";
import { InteractionBreakdown } from "@/lib/api/viewer";

interface InteractionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: string;
  data: InteractionBreakdown;
}

interface InteractionTypeInfo {
  name: string;
  description: string;
  icon: string;
  color: string;
  getValue: (data: InteractionBreakdown) => number;
  getDetails: (
    data: InteractionBreakdown
  ) => { label: string; value: string }[];
}

const interactionTypes: Record<string, InteractionTypeInfo> = {
  聊天: {
    name: "聊天訊息",
    description: "一般聊天室訊息",
    icon: "💬",
    color: "#3b82f6",
    getValue: (d) => d.chatMessages,
    getDetails: (d) => [
      { label: "訊息總數", value: d.chatMessages.toLocaleString() },
      {
        label: "佔總互動比例",
        value: `${(
          (d.chatMessages /
            (d.chatMessages +
              d.subscriptions +
              d.cheers +
              d.giftSubs +
              d.raids)) *
          100
        ).toFixed(1)}%`,
      },
    ],
  },
  訂閱: {
    name: "訂閱通知",
    description: "新訂閱或續訂通知",
    icon: "⭐",
    color: "#8b5cf6",
    getValue: (d) => d.subscriptions,
    getDetails: (d) => [
      { label: "訂閱次數", value: d.subscriptions.toLocaleString() },
      {
        label: "佔總互動比例",
        value: `${(
          (d.subscriptions /
            (d.chatMessages +
              d.subscriptions +
              d.cheers +
              d.giftSubs +
              d.raids)) *
          100
        ).toFixed(1)}%`,
      },
    ],
  },
  小奇點: {
    name: "Bits 贊助",
    description: "使用 Bits 小奇點贊助",
    icon: "💎",
    color: "#eab308",
    getValue: (d) => d.cheers,
    getDetails: (d) => [
      { label: "贊助次數", value: d.cheers.toLocaleString() },
      { label: "總 Bits 數", value: (d.totalBits || 0).toLocaleString() },
      {
        label: "預估價值",
        value: `$${((d.totalBits || 0) / 100).toFixed(2)} USD`,
      },
    ],
  },
  贈禮: {
    name: "贈送訂閱",
    description: "贈送訂閱給其他觀眾",
    icon: "🎁",
    color: "#f43f5e",
    getValue: (d) => d.giftSubs,
    getDetails: (d) => [
      { label: "贈禮次數", value: d.giftSubs.toLocaleString() },
      {
        label: "佔總互動比例",
        value: `${(
          (d.giftSubs /
            (d.chatMessages +
              d.subscriptions +
              d.cheers +
              d.giftSubs +
              d.raids)) *
          100
        ).toFixed(1)}%`,
      },
    ],
  },
  揪團: {
    name: "Raid 參與",
    description: "參與 Raid 揪團活動",
    icon: "🎉",
    color: "#10b981",
    getValue: (d) => d.raids,
    getDetails: (d) => [
      { label: "揪團次數", value: d.raids.toLocaleString() },
      {
        label: "佔總互動比例",
        value: `${(
          (d.raids /
            (d.chatMessages +
              d.subscriptions +
              d.cheers +
              d.giftSubs +
              d.raids)) *
          100
        ).toFixed(1)}%`,
      },
    ],
  },
};

export function InteractionDetailModal({
  isOpen,
  onClose,
  type,
  data,
}: InteractionDetailModalProps) {
  const typeInfo = interactionTypes[type];

  if (!isOpen || !typeInfo) return null;

  const details = typeInfo.getDetails(data);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-card border shadow-2xl p-6 mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span
              className="text-3xl p-2 rounded-xl"
              style={{ backgroundColor: `${typeInfo.color}20` }}
            >
              {typeInfo.icon}
            </span>
            <div>
              <h2 className="text-xl font-bold">{typeInfo.name}</h2>
              <p className="text-sm text-muted-foreground">
                {typeInfo.description}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            aria-label="關閉"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Stats */}
        <div className="space-y-4">
          {details.map((detail, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-4 rounded-xl bg-muted/50"
            >
              <span className="text-muted-foreground">{detail.label}</span>
              <span className="font-semibold text-lg">{detail.value}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t">
          <button
            onClick={onClose}
            className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}

// Hook for managing modal state
export function useInteractionDetailModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<string>("");

  const openModal = (type: string) => {
    setSelectedType(type);
    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
    setSelectedType("");
  };

  return {
    isOpen,
    selectedType,
    openModal,
    closeModal,
  };
}
