import { useEffect, useState } from "react";
import "./App.css";

interface Status {
  isAuthenticated: boolean;
  currentChannel: string | null;
  heartbeatCount: number;
}

function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 從 Background 獲取狀態
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response: Status) => {
      setStatus(response);
      setLoading(false);
    });

    // 定時更新狀態
    const interval = setInterval(() => {
      chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response: Status) => {
        setStatus(response);
      });
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="popup">
        <div className="loading">載入中...</div>
      </div>
    );
  }

  return (
    <div className="popup">
      <div className="header">
        <h1>🎮 Twitch Tracker</h1>
      </div>

      <div className="status-section">
        <div className={`status-item ${status?.isAuthenticated ? "connected" : "disconnected"}`}>
          <span className="label">連線狀態</span>
          <span className="value">{status?.isAuthenticated ? "✅ 已連線" : "❌ 未登入"}</span>
        </div>

        <div className="status-item">
          <span className="label">追蹤頻道</span>
          <span className="value">{status?.currentChannel || "無"}</span>
        </div>

        <div className="status-item">
          <span className="label">本次心跳</span>
          <span className="value">{status?.heartbeatCount || 0} 次</span>
        </div>
      </div>

      {!status?.isAuthenticated && (
        <div className="hint">
          <p>請先登入儀表板以啟用追蹤功能</p>
          <a
            href="https://twitch-monitoring-and-statistics-sy.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="login-link"
          >
            前往登入
          </a>
        </div>
      )}

      <div className="footer">
        <span>v1.0.0</span>
      </div>
    </div>
  );
}

export default App;
