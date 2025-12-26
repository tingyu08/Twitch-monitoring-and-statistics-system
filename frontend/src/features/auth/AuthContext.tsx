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
    console.log("[Logout] Starting logout process...");
    try {
      await apiLogout();
      console.log("[Logout] API call successful");
    } catch (err) {
      console.error("[Logout] API call failed:", err);
    }

    // 無論 API 成功或失敗，都執行清理
    setUser(null);
    setError(null);

    // 清除所有 localStorage 和 sessionStorage
    try {
      localStorage.clear();
      sessionStorage.clear();
      console.log("[Logout] Storage cleared");
    } catch (e) {
      console.error("[Logout] Failed to clear storage:", e);
    }

    // 使用完整 URL 跳轉，並延遲確保 Cookie 清除完成
    console.log("[Logout] Redirecting to home...");
    setTimeout(() => {
      // 使用完整 URL 而非相對路徑
      const homeUrl = window.location.origin + "/";
      console.log("[Logout] Navigating to:", homeUrl);
      window.location.assign(homeUrl);
    }, 500); // 增加延遲到 500ms
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
