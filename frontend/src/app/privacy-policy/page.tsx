import React from "react";

export const metadata = {
  title: "隱私政策 - Twitch Analytics",
  description: "了解我們如何收集、使用和保護您的個人資料",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 font-sans">
      <div className="max-w-4xl mx-auto px-4 py-16">
        <header className="mb-12 text-center">
          <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-6 drop-shadow-lg">
            隱私權政策
          </h1>
          <p className="text-purple-200/70 text-lg">
            承諾保護您的數據安全與透明度
          </p>
          <div className="mt-4 inline-block px-4 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-sm">
            最後更新：2025 年 12 月
          </div>
        </header>

        <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-8 md:p-12 shadow-2xl space-y-12 text-gray-300 leading-relaxed">
          {/* 1. 收集的資料 */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 text-sm border border-purple-500/30">
                1
              </span>
              我們收集哪些資料
            </h2>
            <div className="pl-11 space-y-4">
              <p className="text-gray-300">
                當您使用我們的服務時，我們可能收集以下類型的資料，以提供完整的分析功能：
              </p>
              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <div className="bg-white/5 p-4 rounded-xl border border-white/5 hover:border-purple-500/30 transition-colors">
                  <h3 className="font-semibold text-purple-300 mb-2">
                    帳號資訊
                  </h3>
                  <p className="text-sm text-gray-400">
                    Twitch 使用者名稱、顯示名稱、頭像與唯一識別碼 (ID)。
                  </p>
                </div>
                <div className="bg-white/5 p-4 rounded-xl border border-white/5 hover:border-purple-500/30 transition-colors">
                  <h3 className="font-semibold text-purple-300 mb-2">
                    觀看統計
                  </h3>
                  <p className="text-sm text-gray-400">
                    觀看時間、時段分佈習慣、以及長期的月度聚合數據。
                  </p>
                </div>
                <div className="bg-white/5 p-4 rounded-xl border border-white/5 hover:border-purple-500/30 transition-colors">
                  <h3 className="font-semibold text-purple-300 mb-2">
                    互動記錄
                  </h3>
                  <p className="text-sm text-gray-400">
                    聊天訊息數量、訂閱狀態、Cheer 與 Raid 等互動行為統計。
                  </p>
                </div>
                <div className="bg-white/5 p-4 rounded-xl border border-white/5 hover:border-purple-500/30 transition-colors">
                  <h3 className="font-semibold text-purple-300 mb-2">
                    成就進度
                  </h3>
                  <p className="text-sm text-gray-400">
                    平台專屬的成就徽章解鎖狀態與進度追蹤。
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* 2. 資料用途 */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 text-sm border border-purple-500/30">
                2
              </span>
              資料用途
            </h2>
            <div className="pl-11">
              <ul className="space-y-3 relative before:absolute before:left-[-22px] before:top-4 before:bottom-4 before:w-px before:bg-gradient-to-b before:from-purple-500/50 before:to-transparent">
                {[
                  "展示個人化的觀看統計儀表板與互動分析報告",
                  "計算您在各頻道的觀眾排名與百分位",
                  "生成觀眾足跡總覽與多維度雷達圖",
                  "持續優化服務品質與個性化體驗",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-2.5 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* 3. 資料儲存 */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 text-sm border border-purple-500/30">
                3
              </span>
              資料安全
            </h2>
            <div className="pl-11 bg-gradient-to-r from-blue-500/10 to-purple-500/10 p-6 rounded-xl border border-blue-500/20">
              <p className="text-blue-200">
                您的資料儲存在具備嚴格安全措施的伺服器上。我們採用業界標準的加密與保護技術，確保您的個人資訊不會輕易外洩或遭未經授權的存取。
              </p>
            </div>
          </section>

          {/* 4. 第三方分享 */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 text-sm border border-purple-500/30">
                4
              </span>
              第三方分享
            </h2>
            <div className="pl-11">
              <div className="flex items-start gap-4 p-4 bg-green-500/10 rounded-xl border border-green-500/20 mb-4">
                <div className="text-green-400 text-xl">✓</div>
                <div>
                  <h4 className="font-bold text-green-400 mb-1">
                    我們承諾不販售您的資料
                  </h4>
                  <p className="text-sm text-green-300/80">
                    我們絕不會將您的個人資料出售給第三方用於廣告或行銷目的。
                  </p>
                </div>
              </div>
              <p className="text-sm text-gray-400 mt-2">
                我們僅在以下情況分享資料：獲得您明確同意、遵守法律要求、或為了保護我們的合法權利與使用者安全。
              </p>
            </div>
          </section>

          {/* 5. 權利 */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 text-sm border border-purple-500/30">
                5
              </span>
              您的權利對照表
            </h2>
            <div className="pl-11 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="py-3 px-4 text-purple-300 font-medium">
                      權利類型
                    </th>
                    <th className="py-3 px-4 text-purple-300 font-medium">
                      說明
                    </th>
                    <th className="py-3 px-4 text-purple-300 font-medium text-right">
                      操作方式
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {[
                    {
                      name: "存取權",
                      desc: "查看我們收集的所有關於您的資料",
                      action: "儀表板",
                    },
                    {
                      name: "匯出權",
                      desc: "下載 JSON/CSV 格式的完整資料副本",
                      action: "資料管理 -> 匯出",
                    },
                    {
                      name: "刪除權",
                      desc: "請求永久刪除帳號（含 7 天冷靜期）",
                      action: "資料管理 -> 刪除",
                    },
                    {
                      name: "控制權",
                      desc: "隨時開啟或關閉特定資料的收集",
                      action: "隱私設定",
                    },
                  ].map((row, i) => (
                    <tr
                      key={i}
                      className="hover:bg-white/5 transition-colors group"
                    >
                      <td className="py-4 px-4 font-semibold text-white">
                        {row.name}
                      </td>
                      <td className="py-4 px-4 text-gray-400">{row.desc}</td>
                      <td className="py-4 px-4 text-right">
                        <span className="inline-block px-3 py-1 rounded-full bg-white/5 text-xs text-gray-300 border border-white/10 group-hover:border-purple-500/30 transition-colors">
                          {row.action}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-6 text-center text-gray-400">
              前往{" "}
              <a
                href="/dashboard/viewer/settings"
                className="text-purple-400 hover:text-purple-300 underline underline-offset-4 decoration-purple-500/50 hover:decoration-purple-400"
              >
                隱私設定頁面
              </a>{" "}
              行使您的權利。
            </p>
          </section>

          {/* 6. Cookie & 7. Kids & 8. Contact */}
          <div className="grid md:grid-cols-2 gap-8 pt-8 border-t border-white/10">
            <section>
              <h3 className="text-xl font-bold text-white mb-4">
                Cookie 與追蹤
              </h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                我們僅使用必要的 Cookie
                來維持您的登入狀態與偏好設定。我們不使用第三方追蹤
                Cookie，亦不會進行跨網站追蹤。
              </p>
            </section>
            <section>
              <h3 className="text-xl font-bold text-white mb-4">
                未成年人保護
              </h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                本服務不面向 13 歲以下的兒童。若發現無意間收集了 13
                歲以下兒童的資料，系統將立即執行刪除程序。
              </p>
            </section>
          </div>
        </div>

        {/* Footer Action */}
        <div className="mt-16 text-center space-y-4">
          <p className="text-gray-400 mb-6">對隱私政策有疑問？</p>
          <div className="flex justify-center gap-4">
            <a
              href="/dashboard/viewer/settings"
              className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-full shadow-lg shadow-purple-500/20 hover:shadow-purple-500/40 hover:-translate-y-0.5 transition-all duration-300"
            >
              前往隱私設定
            </a>
            <a
              href="/"
              className="px-8 py-3 bg-white/5 border border-white/10 text-white font-medium rounded-full hover:bg-white/10 transition-all duration-300"
            >
              回首頁
            </a>
          </div>
          <p className="text-xs text-gray-500 mt-8">
            聯絡我們: privacy@twitch-analytics.example.com
          </p>
        </div>
      </div>
    </main>
  );
}
