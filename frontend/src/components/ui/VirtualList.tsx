"use client";

import type { ListChildComponentProps } from "react-window";
import { FixedSizeList, VariableSizeList } from "react-window";
import {
  useRef,
  useCallback,
  forwardRef,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * VirtualList - 虛擬滾動列表元件
 * 用於渲染大量列表項目時只繪製可見區域，大幅提升效能
 */

interface VirtualListProps<T> {
  /** 資料陣列 */
  items: T[];
  /** 每個項目的高度 (固定高度模式) */
  itemHeight: number;
  /** 列表容器高度 */
  height: number;
  /** 列表容器寬度 */
  width?: number | string;
  /** 渲染單一項目的函數 */
  renderItem: (item: T, index: number, style: CSSProperties) => ReactNode;
  /** 額外的 className */
  className?: string;
  /** 滾動時的 overscan 數量 (預先渲染的項目數) */
  overscanCount?: number;
}

export function VirtualList<T>({
  items,
  itemHeight,
  height,
  width = "100%",
  renderItem,
  className,
  overscanCount = 5,
}: VirtualListProps<T>) {
  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const item = items[index];
      return <>{renderItem(item, index, style)}</>;
    },
    [items, renderItem]
  );

  return (
    <FixedSizeList
      height={height}
      width={width}
      itemCount={items.length}
      itemSize={itemHeight}
      overscanCount={overscanCount}
      className={className}
    >
      {Row}
    </FixedSizeList>
  );
}

/**
 * VirtualListVariableHeight - 可變高度的虛擬滾動列表
 */
interface VirtualListVariableProps<T> {
  items: T[];
  getItemHeight: (index: number) => number;
  height: number;
  width?: number | string;
  renderItem: (item: T, index: number, style: CSSProperties) => ReactNode;
  className?: string;
  overscanCount?: number;
}

export function VirtualListVariable<T>({
  items,
  getItemHeight,
  height,
  width = "100%",
  renderItem,
  className,
  overscanCount = 5,
}: VirtualListVariableProps<T>) {
  const listRef = useRef<VariableSizeList>(null);

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const item = items[index];
      return <>{renderItem(item, index, style)}</>;
    },
    [items, renderItem]
  );

  return (
    <VariableSizeList
      ref={listRef}
      height={height}
      width={width}
      itemCount={items.length}
      itemSize={getItemHeight}
      overscanCount={overscanCount}
      className={className}
    >
      {Row}
    </VariableSizeList>
  );
}

/**
 * useVirtualListHeight - 計算列表容器應有的高度
 */
export function useVirtualListHeight(
  containerRef: React.RefObject<HTMLElement | null>,
  fallbackHeight: number = 400
): number {
  const rect = containerRef.current?.getBoundingClientRect();
  return rect?.height || fallbackHeight;
}
