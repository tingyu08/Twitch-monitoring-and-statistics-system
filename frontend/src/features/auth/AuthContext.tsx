"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getMe, logout as apiLogout, type StreamerInfo } from "@/lib/api/auth";

interface AuthContextType {
  user: StreamerInfo | null;
  loading: boolean;
  error: string | null;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StreamerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = async () => {
    try {
      setLoading(true);
      setError(null);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c123c75d-d53a-45de-8d08-1605f5f6c842',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'AuthContext.tsx:23',message:'fetchUser called',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'auth-context',hypothesisId:'H6'})}).catch(()=>{});
      // #endregion
      const userData = await getMe();
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c123c75d-d53a-45de-8d08-1605f5f6c842',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'AuthContext.tsx:27',message:'getMe succeeded',data:{streamerId:userData.streamerId,displayName:userData.displayName},timestamp:Date.now(),sessionId:'debug-session',runId:'auth-context',hypothesisId:'H6'})}).catch(()=>{});
      // #endregion
      setUser(userData);
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c123c75d-d53a-45de-8d08-1605f5f6c842',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'AuthContext.tsx:30',message:'getMe failed',data:{error:err instanceof Error ? err.message : String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'auth-context',hypothesisId:'H6'})}).catch(()=>{});
      // #endregion
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
      console.error("Logout failed:", err);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        logout,
        refresh: fetchUser,
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

