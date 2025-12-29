"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import {
  getMe,
  logout as apiLogout,
  type UserInfo,
  isStreamer as checkIsStreamer,
  isViewer as checkIsViewer,
} from "@/lib/api/auth";
import { authLogger } from "@/lib/logger";

interface AuthContextType {
  user: UserInfo | null;
  loading: boolean;
  error: string | null;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  isStreamer: boolean;
  isViewer: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = async () => {
    try {
      setLoading(true);
      setError(null);
      const userData = await getMe();
      setUser(userData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch user");
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    // 先執行本地清理，確保 UI 立即響應
    setUser(null);
    setError(null);

    // 清除所有 localStorage 和 sessionStorage，但保留 logout_pending
    try {
      localStorage.clear();
      localStorage.setItem("logout_pending", "true");
      sessionStorage.clear();
    } catch {
      // 忽略錯誤
    }

    // 非同步調用後端登出 API（設置 3 秒超時）
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), 3000)
    );

    try {
      await Promise.race([apiLogout(), timeoutPromise]);
    } catch {
      // 即使 API 調用失敗或超時，也繼續跳轉
    }

    // 跳轉到首頁
    window.location.href = "/";
  };

  useEffect(() => {
    fetchUser();
  }, []);

  const isStreamer = useMemo(
    () => user !== null && checkIsStreamer(user),
    [user]
  );
  const isViewer = useMemo(() => user !== null && checkIsViewer(user), [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        logout,
        refresh: fetchUser,
        isStreamer,
        isViewer,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthSession() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuthSession must be used within an AuthProvider");
  }
  return context;
}
