"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  variant?: "text" | "circle" | "rect" | "card";
  width?: string | number;
  height?: string | number;
  animate?: boolean;
}

/**
 * Skeleton Loading Component
 * 用於在資料載入時顯示骨架屏，提升感知效能
 */
export function Skeleton({
  className,
  variant = "rect",
  width,
  height,
  animate = true,
}: SkeletonProps) {
  const baseClasses = cn(
    "bg-gray-200 dark:bg-gray-700",
    animate && "animate-pulse",
    variant === "circle" && "rounded-full",
    variant === "text" && "rounded h-4",
    variant === "rect" && "rounded-lg",
    variant === "card" && "rounded-xl",
    className
  );

  const style = {
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height,
  };

  return <div className={baseClasses} style={style} />;
}

/**
 * Skeleton for Chart containers
 */
export function ChartSkeleton({ height = 250 }: { height?: number }) {
  return (
    <div className="theme-card p-6">
      <div className="flex items-center justify-between mb-4">
        <Skeleton variant="text" width={120} height={20} />
        <Skeleton variant="rect" width={80} height={28} />
      </div>
      <Skeleton variant="rect" width="100%" height={height} />
    </div>
  );
}

/**
 * Skeleton for Stats cards
 */
export function StatCardSkeleton() {
  return (
    <div className="theme-card p-6">
      <div className="flex items-center gap-3 mb-3">
        <Skeleton variant="circle" width={40} height={40} />
        <Skeleton variant="text" width={80} />
      </div>
      <Skeleton variant="text" width={60} height={32} className="mb-2" />
      <Skeleton variant="text" width={100} height={14} />
    </div>
  );
}

/**
 * Skeleton for Avatar with name
 */
export function AvatarSkeleton({ size = 48 }: { size?: number }) {
  return (
    <div className="flex items-center gap-3">
      <Skeleton variant="circle" width={size} height={size} />
      <div className="flex flex-col gap-2">
        <Skeleton variant="text" width={100} />
        <Skeleton variant="text" width={60} height={12} />
      </div>
    </div>
  );
}

/**
 * Skeleton for Table rows
 */
export function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-gray-200 dark:border-gray-700">
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          width={`${100 / columns}%`}
          height={16}
        />
      ))}
    </div>
  );
}
