import { create } from "zustand";
import { useShallow } from "zustand/shallow";

/**
 * Socket.IO 即時數據狀態管理
 * 使用 Zustand 來最小化 re-render
 */

// ============ 類型定義 ============
interface LiveNotification {
  id: string;
  type: "stream.online" | "stream.offline" | "stream.raid" | "channel.update";
  channelName: string;
  message: string;
  timestamp: Date;
}

interface StreamStatus {
  channelId: string;
  isLive: boolean;
  viewerCount?: number;
  title?: string;
  gameName?: string;
  startedAt?: Date;
}

interface SocketState {
  // 連線狀態
  isConnected: boolean;
  lastPing: Date | null;

  // 即時通知
  notifications: LiveNotification[];

  // 頻道直播狀態
  streamStatuses: Map<string, StreamStatus>;

  // Actions
  setConnected: (connected: boolean) => void;
  addNotification: (
    notification: Omit<LiveNotification, "id" | "timestamp">
  ) => void;
  clearNotifications: () => void;
  updateStreamStatus: (status: StreamStatus) => void;
  setPing: () => void;
}

// ============ Store 實作 ============
export const useSocketStore = create<SocketState>((set, get) => ({
  // 初始狀態
  isConnected: false,
  lastPing: null,
  notifications: [],
  streamStatuses: new Map(),

  // 連線狀態
  setConnected: (connected) => set({ isConnected: connected }),
  setPing: () => set({ lastPing: new Date() }),

  // 通知管理
  addNotification: (notification) => {
    const newNotification: LiveNotification = {
      ...notification,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
    };

    set((state) => ({
      notifications: [newNotification, ...state.notifications].slice(0, 50), // 最多保留 50 條
    }));
  },

  clearNotifications: () => set({ notifications: [] }),

  // 直播狀態更新
  updateStreamStatus: (status) => {
    set((state) => {
      const newMap = new Map(state.streamStatuses);
      newMap.set(status.channelId, status);
      return { streamStatuses: newMap };
    });
  },
}));

// ============ Selectors ============
export const useConnectionStatus = () =>
  useSocketStore((state) => state.isConnected);

export const useNotifications = () =>
  useSocketStore(useShallow((state) => state.notifications));

export function useStreamStatus(channelId: string): StreamStatus | undefined {
  return useSocketStore((state) => {
    const map = state.streamStatuses;
    return map.get(channelId);
  });
}

export const useSocketActions = () =>
  useSocketStore(
    useShallow((state) => ({
      setConnected: state.setConnected,
      addNotification: state.addNotification,
      updateStreamStatus: state.updateStreamStatus,
      setPing: state.setPing,
    }))
  );
