"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
// 使用我們寫好的 auth library，而不是直接用 httpClient
import { getMe, type StreamerInfo } from '@/lib/api/auth';
import { useAuthSession } from '@/features/auth/AuthContext';

export default function StreamerDashboard() {
  // 使用正確的型別 StreamerInfo
  const [user, setUser] = useState<StreamerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const router = useRouter();
  const { logout } = useAuthSession();

  useEffect(() => {
    const fetchData = async () => {
      try {
        // [FIX] 使用 getMe() 函式，它會呼叫正確的 /api/auth/me
        const data = await getMe();
        setUser(data);
      } catch (err: any) {
        console.error("Dashboard fetch error:", err);
        setError(err.message || '無法獲取資料');
        
        // 驗證失敗處理
        // 寬鬆判斷錯誤訊息，包含 401 相關的關鍵字都導回首頁
        const errMsg = err.message?.toLowerCase() || '';
        if (errMsg.includes('unauthorized') || errMsg.includes('auth') || errMsg.includes('token')) {
            setTimeout(() => router.push('/'), 2000);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
        <p className="text-red-400 mb-4 text-xl">無法載入資料</p>
        <p className="text-gray-400 mb-4">{error}</p>
        <p className="text-gray-500 text-sm">正在返回首頁...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8 border-b border-gray-700 pb-4 flex justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            {/* 使用正確的欄位名稱 avatarUrl */}
            {user?.avatarUrl && (
              <img 
                src={user.avatarUrl} 
                alt="Profile" 
                className="w-14 h-14 rounded-full border-2 border-purple-500"
              />
            )}
            <div>
              <h1 className="text-3xl font-bold text-purple-400">實況主儀表板</h1>
              <p className="text-gray-400 mt-2">
                歡迎回來，{user?.displayName || '實況主'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm text-white transition-colors"
          >
            登出
          </button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 基本資料卡片 */}
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-purple-300">帳戶資訊</h2>
            <div className="space-y-3">
              <div className="flex justify-between border-b border-gray-700 pb-2">
                <span className="text-gray-400">顯示名稱</span>
                <span>{user?.displayName}</span>
              </div>
              <div className="flex justify-between border-b border-gray-700 pb-2">
                <span className="text-gray-400">Twitch ID</span>
                <span className="text-xs font-mono text-gray-500">{user?.twitchUserId}</span>
              </div>
              <div className="flex justify-between border-b border-gray-700 pb-2">
                <span className="text-gray-400">系統 ID</span>
                <span className="text-xs font-mono text-gray-500">{user?.streamerId}</span>
              </div>
               <div className="flex justify-between border-b border-gray-700 pb-2">
                <span className="text-gray-400">頻道連結</span>
                <a href={user?.channelUrl} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 text-sm truncate max-w-[200px]">
                    {user?.channelUrl}
                </a>
              </div>
            </div>
          </div>

          {/* 功能區塊 */}
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-purple-300">快速功能</h2>
            <div className="space-y-3">
              <button className="w-full bg-purple-600 hover:bg-purple-700 text-white py-2 px-4 rounded transition duration-200">
                管理實況設定
              </button>
              <button className="w-full bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded transition duration-200">
                查看收益分析
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}