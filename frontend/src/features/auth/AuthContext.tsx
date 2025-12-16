"use client";

import { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from "react";
import { getMe, logout as apiLogout, type UserInfo, isStreamer as checkIsStreamer, isViewer as checkIsViewer } from "@/lib/api/auth";
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
    try {
      await apiLogout();
      setUser(null);
      setError(null);
      // 導向首頁
      window.location.href = "/";
    } catch (err) {
      authLogger.error("Logout failed:", err);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  const isStreamer = useMemo(() => user !== null && checkIsStreamer(user), [user]);
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
