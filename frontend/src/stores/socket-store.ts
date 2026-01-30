import { create } from "zustand";

/**
 * Socket.IO 連線狀態管理
 * P1 Optimization: 簡化版本 - 移除未使用的 streamStatuses 和 notifications
 *
 * 注意：目前這個 store 沒有被使用
 * 連線狀態由 SocketProvider 透過 Context 管理
 * 保留此檔案以備未來擴展
 */

interface SocketState {
  isConnected: boolean;
  setConnected: (connected: boolean) => void;
}

export const useSocketStore = create<SocketState>((set) => ({
  isConnected: false,
  setConnected: (connected) => set({ isConnected: connected }),
}));

export const useConnectionStatus = () => useSocketStore((state) => state.isConnected);
