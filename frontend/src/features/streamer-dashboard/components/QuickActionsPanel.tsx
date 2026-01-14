"use client";

import { useTranslations } from "next-intl";
import { Settings, DollarSign } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

interface QuickActionsPanelProps {
  onManageSettings?: () => void;
}

export function QuickActionsPanel({
  onManageSettings,
}: QuickActionsPanelProps) {
  const t = useTranslations("streamer");
  const params = useParams();
  const locale = (params?.locale as string) || "zh-TW";

  return (
    <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 border border-gray-700/50">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <Settings className="w-5 h-5 text-purple-400" />
        {t("quickActions")}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 管理實況設定 */}
        <button
          onClick={onManageSettings}
          className="group flex items-center gap-3 p-4 bg-gradient-to-r from-purple-600/20 to-purple-500/10 
                     rounded-lg border border-purple-500/30 hover:border-purple-400/50 
                     transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-purple-500/10"
        >
          <div className="p-2 bg-purple-500/20 rounded-lg group-hover:bg-purple-500/30 transition-colors">
            <Settings className="w-5 h-5 text-purple-400" />
          </div>
          <div className="text-left">
            <span className="block text-white font-medium">
              {t("manageSettings")}
            </span>
            <span className="text-xs text-gray-400">編輯標題、分類、標籤</span>
          </div>
        </button>

        {/* 查看收益分析 */}
        <Link
          href={`/${locale}/dashboard/streamer/revenue`}
          className="group flex items-center gap-3 p-4 bg-gradient-to-r from-green-600/20 to-green-500/10 
                     rounded-lg border border-green-500/30 hover:border-green-400/50 
                     transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-green-500/10"
        >
          <div className="p-2 bg-green-500/20 rounded-lg group-hover:bg-green-500/30 transition-colors">
            <DollarSign className="w-5 h-5 text-green-400" />
          </div>
          <div className="text-left">
            <span className="block text-white font-medium">
              {t("viewRevenue")}
            </span>
            <span className="text-xs text-gray-400">訂閱與 Bits 統計</span>
          </div>
        </Link>
      </div>
    </div>
  );
}
