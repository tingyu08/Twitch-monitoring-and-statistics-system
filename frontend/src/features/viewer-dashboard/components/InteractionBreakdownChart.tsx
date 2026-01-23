"use client";

import { InteractionBreakdown } from "@/lib/api/viewer";
import { PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { InteractionDetailModal, useInteractionDetailModal } from "./InteractionDetailModal";
import { SafeResponsiveContainer } from "@/components/charts/SafeResponsiveContainer";

import { useTranslations } from "next-intl";

interface InteractionBreakdownChartProps {
  data: InteractionBreakdown;
  height?: number;
}

export function InteractionBreakdownChart({ data, height = 350 }: InteractionBreakdownChartProps) {
  const t = useTranslations();
  const { isOpen, selectedType, openModal, closeModal } = useInteractionDetailModal();

  const chartData = [
    {
      id: "chat",
      name: t("stats.interactionTypes.chat"),
      value: data.chatMessages,
      color: "#3b82f6",
    },
    {
      id: "sub",
      name: t("stats.interactionTypes.sub"),
      value: data.subscriptions,
      color: "#8b5cf6",
    },
    {
      id: "cheer",
      name: t("stats.interactionTypes.cheer"),
      value: data.cheers,
      color: "#eab308",
    },
    {
      id: "gift",
      name: t("stats.interactionTypes.gift"),
      value: data.giftSubs,
      color: "#f43f5e",
    },
    {
      id: "raid",
      name: t("stats.interactionTypes.raid"),
      value: data.raids,
      color: "#10b981",
    },
  ].filter((d) => d.value > 0);

  if (chartData.length === 0) {
    return (
      <div className="flex h-[350px] w-full items-center justify-center rounded-xl border bg-card text-card-foreground shadow p-4">
        <p className="text-muted-foreground">{t("stats.noInteractionData")}</p>
      </div>
    );
  }

  const handlePieClick = (entry: { id: string }) => {
    openModal(entry.id);
  };

  return (
    <>
      <div
        className="rounded-xl border bg-card text-card-foreground shadow"
        aria-label="Interaction Breakdown Chart"
      >
        <div className="p-6 flex flex-col space-y-1.5">
          <h3 className="font-semibold leading-none tracking-tight">
            {t("stats.interactionParams")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("stats.clickToView")}</p>
        </div>
        <div className="p-6 pt-0">
          <SafeResponsiveContainer height={height}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
                onClick={handlePieClick}
                style={{ cursor: "pointer" }}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.color}
                    stroke={entry.color}
                    className="hover:opacity-80 transition-opacity"
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => [((value as number) ?? 0).toLocaleString(), t("stats.count")]}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e2e8f0",
                }}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                onClick={(e) => {
                  if (typeof e.value === "string") {
                    openModal(e.value);
                  }
                }}
                wrapperStyle={{ cursor: "pointer" }}
              />
            </PieChart>
          </SafeResponsiveContainer>
        </div>
      </div>

      <InteractionDetailModal
        isOpen={isOpen}
        onClose={closeModal}
        type={selectedType}
        data={data}
      />
    </>
  );
}
