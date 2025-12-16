"use client";

import { InteractionBreakdown } from "@/lib/api/viewer";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import {
  InteractionDetailModal,
  useInteractionDetailModal,
} from "./InteractionDetailModal";

interface InteractionBreakdownChartProps {
  data: InteractionBreakdown;
  height?: number;
}

export function InteractionBreakdownChart({
  data,
  height = 350,
}: InteractionBreakdownChartProps) {
  const { isOpen, selectedType, openModal, closeModal } =
    useInteractionDetailModal();

  const chartData = [
    { name: "聊天", value: data.chatMessages, color: "#3b82f6" },
    { name: "訂閱", value: data.subscriptions, color: "#8b5cf6" },
    { name: "小奇點", value: data.cheers, color: "#eab308" },
    { name: "贈禮", value: data.giftSubs, color: "#f43f5e" },
    { name: "揪團", value: data.raids, color: "#10b981" },
  ].filter((d) => d.value > 0);

  if (chartData.length === 0) {
    return (
      <div className="flex h-[350px] w-full items-center justify-center rounded-xl border bg-card text-card-foreground shadow p-4">
        <p className="text-muted-foreground">無足夠數據顯示互動分佈</p>
      </div>
    );
  }

  const handlePieClick = (entry: { name: string }) => {
    openModal(entry.name);
  };

  return (
    <>
      <div
        className="rounded-xl border bg-card text-card-foreground shadow"
        aria-label="Interaction Breakdown Chart"
      >
        <div className="p-6 flex flex-col space-y-1.5">
          <h3 className="font-semibold leading-none tracking-tight">
            互動類型分佈
          </h3>
          <p className="text-sm text-muted-foreground">點擊各類型查看詳情</p>
        </div>
        <div className="p-6 pt-0">
          <div style={{ width: "100%", height }}>
            <ResponsiveContainer>
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
                  formatter={(value: number) => [
                    value.toLocaleString(),
                    "次數",
                  ]}
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
            </ResponsiveContainer>
          </div>
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
