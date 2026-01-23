# Twitch API 功能缺口分析

**文件版本**: v1.0  
**最後更新**: 2025-12-11  
**目的**: 識別 Twitch API 支援但專案尚未使用的功能，評估優先級與可行性

---

## 📊 當前已使用的 Twitch API 功能

### Epic 1 - 實況主分析儀表板

- ✅ **OAuth Authentication** (Streamer Login)
- ✅ **Streams API** - 獲取直播狀態與統計
- ✅ **Users API** - 獲取實況主個人資料
- ✅ **Subscriptions API** - 訂閱數據（Story 1.4）

### Epic 2 - 觀眾互動分析

- ✅ **OAuth Authentication** (Viewer Login)
- ✅ **Chat API via TMI.js** - IRC 聊天監聽（Story 2.3）
- ✅ **EventSub Webhooks** - 訂閱、贊助事件（Story 2.3）

### Epic 4 - 快速操作中心

- ✅ **Channel Information API** - 更新標題/分類/標籤（Story 4.1）
- ✅ **Subscriptions API** - 訂閱收益統計（Story 4.3）
- ✅ **Bits/Cheers EventSub** - Bits 贊助統計（Story 4.4）

---

## 🔍 Twitch API 支援但尚未使用的功能

### 🎯 高優先級（強烈建議加入）

#### 1. **Clips API** - 精華片段管理

**API 端點**:

- `GET /clips` - 獲取頻道精華片段
- `POST /clips` - 建立精華片段
- `GET /clips/{id}` - 獲取特定片段資訊

**潛在價值**:

- 實況主可查看哪些片段最受歡迎（觀看數、分享數）
- 自動建議「值得剪輯」的時段（基於聊天活躍度、訂閱/贊助事件）
- 觀眾個人頁面：顯示「我出現在哪些精華片段」
- 精華片段績效分析（傳播力、轉換率）

**技術考量**:

- 需要 `clips:edit` OAuth scope（建立片段）
- 需要 `user:read:broadcast` scope（讀取片段）
- 儲存建議：新增 `Clip` 資料表記錄片段 metadata

**建議 Epic**: Epic 5 - 內容優化工具

---

#### 2. **Videos API** - VOD 管理

**API 端點**:

- `GET /videos` - 獲取頻道 VOD 列表
- `DELETE /videos` - 刪除特定 VOD

**潛在價值**:

- 實況主可查看 VOD 觀看統計（完整觀看率、平均觀看時長）
- 自動標記「高價值 VOD」（重播次數多、互動率高）
- 觀眾個人頁面：「我重播過哪些 VOD」
- VOD 保存策略建議（基於表現決定保留或刪除）

**技術考量**:

- 需要 `channel:read:videos` scope（讀取）
- 需要 `channel:manage:videos` scope（刪除）
- 儲存建議：新增 `Video` 資料表記錄 VOD metadata

**建議 Epic**: Epic 5 - 內容優化工具

---

#### 3. **Raids API** - Raid 導流分析

**API 端點**:

- `POST /raids` - 發起 Raid
- EventSub: `channel.raid` - 監聽 Raid 事件

**潛在價值**:

- 實況主可追蹤「Raid 出去」的效果（對方頻道成長、回訪率）
- 實況主可追蹤「被 Raid 進來」的轉換率（新觀眾留存、訂閱轉換）
- Raid 網絡視覺化（與哪些頻道互相 Raid）
- Raid 策略建議（最佳 Raid 對象、最佳時機）

**技術考量**:

- 需要 `channel:manage:raids` scope（發起）
- 需要 `channel:read:raids` scope（讀取歷史）
- EventSub 訂閱：`channel.raid` 事件
- 儲存建議：新增 `RaidEvent` 資料表

**建議 Epic**: Epic 6 - 社群成長工具

---

#### 4. **Predictions API** - 預測互動

**API 端點**:

- `GET /predictions` - 獲取預測活動
- `POST /predictions` - 建立預測
- `PATCH /predictions` - 結算預測

**潛在價值**:

- 實況主可查看預測活動的參與度（參與人數、總點數）
- 分析「哪種預測題目」最能吸引觀眾參與
- 觀眾個人頁面：「我的預測勝率」、「賺取/損失點數統計」
- 預測活動效果分析（對留存率、互動率的影響）

**技術考量**:

- 需要 `channel:read:predictions` scope
- 需要 `channel:manage:predictions` scope
- EventSub: `channel.prediction.begin/progress/end`
- 儲存建議：新增 `Prediction` 與 `PredictionOutcome` 資料表

**建議 Epic**: Epic 7 - 互動功能增強

---

#### 5. **Polls API** - 投票互動

**API 端點**:

- `GET /polls` - 獲取投票活動
- `POST /polls` - 建立投票
- `PATCH /polls` - 結束投票

**潛在價值**:

- 實況主可查看投票參與度（參與人數、選項分布）
- 分析「哪種投票題目」最能吸引觀眾
- 觀眾個人頁面：「我的投票歷史」
- 投票活動效果分析（對留存率的影響）

**技術考量**:

- 需要 `channel:read:polls` scope
- 需要 `channel:manage:polls` scope
- EventSub: `channel.poll.begin/progress/end`
- 儲存建議：新增 `Poll` 與 `PollChoice` 資料表

**建議 Epic**: Epic 7 - 互動功能增強

---

#### 6. **Hype Train API** - Hype Train 分析

**API 端點**:

- `GET /hypetrain/events` - 獲取 Hype Train 事件

**潛在價值**:

- 實況主可查看 Hype Train 發生頻率、貢獻分布
- 分析「什麼觸發了 Hype Train」（遊戲進度、特殊事件）
- Hype Train 對訂閱/贊助的促進效果
- 觀眾個人頁面：「我參與了幾次 Hype Train」、「貢獻排名」

**技術考量**:

- 需要 `channel:read:hype_train` scope
- EventSub: `channel.hype_train.begin/progress/end`
- 儲存建議：新增 `HypeTrainEvent` 資料表

**建議 Epic**: Epic 7 - 互動功能增強

---

### 🎨 中優先級（可加入但非必要）

#### 7. **Goals API** - 訂閱者目標

**API 端點**:

- `GET /goals` - 獲取頻道目標

**潛在價值**:

- 實況主可追蹤「訂閱者目標」進度
- 自動建議合理的目標設定（基於歷史成長率）
- 目標達成後的效果分析（訂閱衝刺期的留存率）

**技術考量**:

- 需要 `channel:read:goals` scope
- 儲存建議：新增 `Goal` 資料表

**建議 Epic**: Epic 5 - 內容優化工具

---

#### 8. **Schedule API** - 直播排程管理

**API 端點**:

- `GET /schedule` - 獲取排程
- `POST /schedule/segment` - 建立排程
- `PATCH /schedule/segment` - 更新排程
- `DELETE /schedule/segment` - 刪除排程

**潛在價值**:

- 實況主可在平台內管理直播排程
- 排程合規性分析（實際開台 vs 預定時間）
- 排程效果分析（預告直播對觀看數的影響）
- 自動排程建議（基於歷史最佳時段）

**技術考量**:

- 需要 `channel:read:schedule` scope
- 需要 `channel:manage:schedule` scope
- 儲存建議：新增 `Schedule` 資料表

**建議 Epic**: Epic 5 - 內容優化工具

---

#### 9. **Moderation API** - 版主管理

**API 端點**:

- `GET /moderation/banned` - 獲取封鎖清單
- `POST /moderation/bans` - 封鎖用戶
- `DELETE /moderation/bans` - 解除封鎖
- `GET /moderation/moderators` - 獲取版主清單
- `POST /moderation/moderators` - 新增版主

**潛在價值**:

- 實況主可在平台內管理版主與封鎖清單
- 版主行為統計（每位版主的管理動作數量）
- 封鎖趨勢分析（封鎖高峰期、常見原因）
- 「毒性預警」系統（異常封鎖增加時提醒）

**技術考量**:

- 需要 `moderation:read` scope
- 需要 `moderator:manage:banned_users` scope
- 儲存建議：新增 `ModerationAction` 資料表

**建議 Epic**: Epic 6 - 社群成長工具

---

#### 10. **Teams API** - 團隊資料

**API 端點**:

- `GET /teams` - 獲取團隊資訊
- `GET /teams/channel` - 獲取頻道所屬團隊

**潛在價值**:

- 顯示實況主所屬的 Twitch Team
- 團隊成員互動分析（跨頻道觀眾重疊度）
- 團隊協作效果（聯合直播、互相 Raid 的效果）

**技術考量**:

- 不需要額外 scope（公開資料）
- 儲存建議：新增 `Team` 資料表

**建議 Epic**: Epic 6 - 社群成長工具

---

#### 11. **Games API** - 遊戲分類資訊

**API 端點**:

- `GET /games` - 搜尋遊戲
- `GET /games/top` - 熱門遊戲排行

**潛在價值**:

- 自動建議「熱門遊戲」（基於當前 Twitch 趨勢）
- 遊戲表現分析（不同遊戲的觀看數、訂閱轉換率）
- 遊戲競爭度分析（該遊戲有多少實況主在播）
- 「藍海遊戲」推薦（熱度高但實況主少的遊戲）

**技術考量**:

- 不需要額外 scope（公開資料）
- 儲存建議：新增 `Game` 資料表

**建議 Epic**: Epic 5 - 內容優化工具

---

#### 12. **Tags API** - 標籤管理

**API 端點**:

- `GET /streams/tags` - 獲取可用標籤
- `GET /channels/tags` - 獲取頻道當前標籤

**潛在價值**:

- 智能標籤建議（基於遊戲、內容類型）
- 標籤效果分析（不同標籤組合對觀看數的影響）
- 熱門標籤追蹤（當前趨勢標籤）

**技術考量**:

- 不需要額外 scope（公開資料）
- 已在 Epic 4 Story 4.1 包含（更新標籤功能）

**建議**: 已規劃

---

### 🔧 低優先級（可選功能）

#### 13. **Extensions API** - 擴充功能管理

**API 端點**:

- `GET /users/extensions` - 獲取已安裝擴充功能
- `PUT /users/extensions` - 啟用/停用擴充功能

**潛在價值**:

- 在平台內管理 Twitch 擴充功能
- 擴充功能效果分析（對互動率的影響）

**技術考量**:

- 需要 `user:read:broadcast` scope
- 需要 `user:edit:broadcast` scope

**建議**: 視需求而定，優先級較低

---

#### 14. **Soundtrack API** - 音樂版權管理

**API 端點**:

- `GET /soundtrack/current_track` - 獲取當前播放音樂

**潛在價值**:

- 顯示實況主使用的音樂
- 版權合規性追蹤

**技術考量**:

- 需要 `user:read:broadcast` scope

**建議**: 除非有明確版權管理需求，否則優先級低

---

#### 15. **Charity Campaign API** - 慈善活動

**API 端點**:

- `GET /charity/campaigns` - 獲取慈善活動資訊

**潛在價值**:

- 追蹤慈善直播的募款進度
- 慈善活動效果分析

**技術考量**:

- 需要 `channel:read:charity` scope

**建議**: 除非有明確慈善功能需求，否則優先級低

---

#### 16. **Channel Points API** - 頻道點數管理

**API 端點**:

- `GET /channel_points/custom_rewards` - 獲取自訂獎勵
- `POST /channel_points/custom_rewards` - 建立自訂獎勵
- `PATCH /channel_points/custom_rewards` - 更新獎勵
- `DELETE /channel_points/custom_rewards` - 刪除獎勵
- `GET /channel_points/custom_rewards/redemptions` - 獲取兌換記錄

**潛在價值**:

- 頻道點數獎勵效果分析（哪些獎勵最受歡迎）
- 兌換趨勢統計（高峰時段、頻率）
- 自動獎勵建議（基於觀眾興趣）
- 觀眾個人頁面：「我兌換過的獎勵」

**技術考量**:

- 需要 `channel:read:redemptions` scope
- 需要 `channel:manage:redemptions` scope
- EventSub: `channel.channel_points_custom_reward_redemption.add`

**建議 Epic**: Epic 7 - 互動功能增強

---

#### 17. **Whispers API** - 私訊功能

**API 端點**:

- `POST /whispers` - 發送私訊

**潛在價值**:

- 實況主可從平台直接發送私訊給觀眾
- 批量私訊功能（如感謝新訂閱者）

**技術考量**:

- 需要 `user:manage:whispers` scope
- Rate limit 較嚴格

**建議**: 除非有明確需求，否則優先級低（易被濫用）

---

#### 18. **AutoMod API** - 自動審查

**API 端點**:

- `POST /moderation/enforcements/status` - 檢查訊息是否會被 AutoMod 阻擋
- `GET /moderation/automod/settings` - 獲取 AutoMod 設定
- `PUT /moderation/automod/settings` - 更新 AutoMod 設定

**潛在價值**:

- 在平台內管理 AutoMod 設定
- AutoMod 效果分析（攔截率、誤判率）

**技術考量**:

- 需要 `moderator:read:automod_settings` scope
- 需要 `moderator:manage:automod_settings` scope

**建議**: 版主管理功能的延伸，視需求而定

---

## 📋 建議的 Epic 規劃

### Epic 5: 內容優化工具（Content Optimization）

**核心功能**:

- Story 5.1: Clips 精華片段分析（Clips API）
- Story 5.2: VOD 重播統計與管理（Videos API）
- Story 5.3: 遊戲表現分析與推薦（Games API）
- Story 5.4: 訂閱者目標追蹤（Goals API）
- Story 5.5: 直播排程管理與分析（Schedule API）

**預估時程**: 6-8 週

---

### Epic 6: 社群成長工具（Community Growth）

**核心功能**:

- Story 6.1: Raid 導流分析與策略（Raids API + EventSub）
- Story 6.2: 版主管理與統計（Moderation API）
- Story 6.3: 團隊協作分析（Teams API）
- Story 6.4: 觀眾留存與成長分析（跨 Epic 1-3 指標匯總）

**預估時程**: 5-7 週

---

### Epic 7: 互動功能增強（Enhanced Interactions）

**核心功能**:

- Story 7.1: Predictions 預測互動分析（Predictions API + EventSub）
- Story 7.2: Polls 投票互動分析（Polls API + EventSub）
- Story 7.3: Hype Train 事件追蹤（Hype Train API + EventSub）
- Story 7.4: 頻道點數獎勵分析（Channel Points API + EventSub）
- Story 7.5: 互動效果綜合報表（彙總各互動來源 KPI）

**預估時程**: 6-8 週

---

### Epic 8: 擴充與合規工具（Extensions & Compliance）

**核心功能**（覆蓋請求的 13, 14, 16, 17, 18）：

- Story 8.1: Extensions 管理與效果分析（Extensions API）
- Story 8.2: Soundtrack 版權資訊追蹤（Soundtrack API）
- Story 8.3: Channel Points 獎勵管理與兌換統計（Channel Points API）
- Story 8.4: Whispers 私訊合規與批次訊息（Whispers API）
- Story 8.5: AutoMod 設定管理與攔截率分析（AutoMod API）

**預估時程**: 6-8 週

**附註**:

- Extensions/Soundtrack/Whispers 預設為低優先級，但若有明確需求可升級。
- Channel Points 與 AutoMod 若需與 Epic 7/6 整合，優先處理資料模型與 EventSub。

---

## 🎯 優先級總結

### 立即加入（Epic 5）

1. ✅ Clips API - 精華片段管理
2. ✅ Videos API - VOD 管理
3. ✅ Games API - 遊戲分析
4. ✅ Goals API - 目標追蹤
5. ✅ Schedule API - 排程管理

### 短期加入（Epic 6）

6. ✅ Raids API - 導流分析
7. ✅ Moderation API - 版主管理
8. ✅ Teams API - 團隊協作

### 中期加入（Epic 7）

9. ✅ Predictions API - 預測互動
10. ✅ Polls API - 投票互動
11. ✅ Hype Train API - Hype Train 分析
12. ✅ Channel Points API - 頻道點數

### 視需求加入

13. ⚠️ Extensions API
14. ⚠️ Soundtrack API
15. ⚠️ Charity Campaign API
16. ⚠️ Whispers API
17. ⚠️ AutoMod API

---

## 📊 功能使用優先級矩陣

| API 功能           | 使用者價值 | 技術複雜度 | 資料完整性 | 優先級 |
| ------------------ | ---------- | ---------- | ---------- | ------ |
| Clips API          | 高         | 中         | 高         | **高** |
| Videos API         | 高         | 中         | 高         | **高** |
| Raids API          | 高         | 低         | 高         | **高** |
| Predictions API    | 中         | 中         | 高         | **高** |
| Polls API          | 中         | 低         | 高         | **高** |
| Hype Train API     | 中         | 中         | 高         | **中** |
| Goals API          | 中         | 低         | 中         | **中** |
| Schedule API       | 中         | 中         | 中         | **中** |
| Moderation API     | 中         | 高         | 中         | **中** |
| Games API          | 高         | 低         | 高         | **高** |
| Teams API          | 低         | 低         | 中         | **低** |
| Channel Points API | 中         | 中         | 高         | **中** |
| Extensions API     | 低         | 中         | 低         | **低** |
| Whispers API       | 低         | 低         | 中         | **低** |
| AutoMod API        | 低         | 中         | 中         | **低** |

---

## 🚀 實作建議

### 階段 1（完成 Epic 2 後）

建議優先實作 **Epic 5: 內容優化工具**，原因：

- Clips 和 VOD 分析直接幫助實況主優化內容策略
- 技術複雜度適中，可快速交付價值
- 與現有分析功能形成完整閉環

### 階段 2（完成 Epic 5 後）

建議實作 **Epic 6: 社群成長工具**，原因：

- Raid 分析幫助實況主擴大觀眾群
- 版主管理是成熟頻道的剛需
- 與 Epic 1-2 的分析功能形成互補

### 階段 3（完成 Epic 6 後）

建議實作 **Epic 7: 互動功能增強**，原因：

- Predictions 和 Polls 是觀眾參與的重要方式
- Hype Train 分析提供深度互動洞察
- 完整互動生態的最後一塊拼圖

---

## 📝 注意事項

### OAuth Scope 擴展

隨著功能增加，需要請求的 OAuth 權限也會增加。建議：

- 採用「漸進式授權」策略（按需請求）
- 清楚說明每個權限的用途
- 提供「最小權限」選項（僅核心功能）

### API Rate Limit 管理

新增功能後，API 呼叫量會顯著增加。建議：

- 實作完善的 Rate Limit 追蹤與告警
- 使用快取減少重複請求
- 實施請求佇列與批次處理

### 資料儲存成本

新增資料表與事件監聽會增加儲存成本。建議：

- 實施資料保留政策（如 90 天自動清理）
- 使用資料壓縮與歸檔
- 監控資料增長速度

---

**結論**: Twitch API 提供了豐富的功能，我們目前僅使用了其中約 30%。建議優先實作 Epic
5-7，可在未來 18-24 週內大幅提升平台價值。
