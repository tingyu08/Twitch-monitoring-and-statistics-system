"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import type { ViewerTrendPoint } from "@/lib/api/viewer";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string | null;
  sessions: ViewerTrendPoint[];
  onSelectSession: (session: ViewerTrendPoint) => void;
}

/**
 * 當天有多場直播時，顯示直播列表讓使用者選擇要查看哪場的小時分析
 */
export function DaySessionsDialog({
  open,
  onOpenChange,
  date,
  sessions,
  onSelectSession,
}: Props) {
  const t = useTranslations();
  const modalRef = useRef<HTMLDivElement>(null);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onOpenChange(false);
    }
  };

  if (!open || !date) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={handleOverlayClick}
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-lg bg-white dark:bg-[#1a1b26] rounded-2xl shadow-2xl p-6 border border-gray-200 dark:border-gray-800 animate-in zoom-in-95 duration-200"
      >
        <button
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>

        <div className="mb-6">
          <h2 className="text-xl font-bold theme-text-primary mb-1">
            {date} {t("charts.daySessionsTitle")}
          </h2>
          <p className="theme-text-secondary text-sm">
            {t("charts.daySessionsDesc", { count: sessions.length })}
          </p>
        </div>

        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {sessions.map((session, index) => {
            const startTime = new Date(session.date);
            const timeStr = `${startTime.getHours().toString().padStart(2, "0")}:${startTime.getMinutes().toString().padStart(2, "0")}`;

            return (
              <button
                key={`${session.date}-${index}`}
                onClick={() => onSelectSession(session)}
                className="w-full text-left p-4 rounded-xl border border-gray-200 dark:border-white/10 hover:border-purple-400 dark:hover:border-purple-500/40 hover:bg-purple-50 dark:hover:bg-purple-500/5 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold theme-text-primary text-sm truncate pr-4">
                    {session.title || "Untitled"}
                  </span>
                  <span className="text-xs theme-text-muted shrink-0">{timeStr}</span>
                </div>
                <div className="flex items-center gap-4 text-xs theme-text-secondary">
                  <span>
                    {t("charts.avgViewers")}: {session.avgViewers.toLocaleString()}
                  </span>
                  <span>
                    {t("charts.peakViewers")}: {session.peakViewers.toLocaleString()}
                  </span>
                  <span>
                    {session.durationHours.toFixed(1)} {t("charts.hours")}
                  </span>
                  {session.category && (
                    <span className="bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded">
                      {session.category}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
