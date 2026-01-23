# Phase 2: Future Expansion Ideas

本文件記錄專案第二階段（Phase
2）的規劃與創意。這些功能屬於進階擴充，旨在進一步區隔市場競爭力，將於核心功能（Epic
1-9）穩定後啟動。

## Epic 10: 遊戲內深度整合 (Game Integration)

### 概念

跳脫單純的 Overlay 視覺層，直接與遊戲程序進行雙向通訊。讓觀眾的互動（訂閱、抖內、留言）能夠直接改變遊戲內的環境、數值或事件。

### 潛在 Stories

#### Story 10.1 – Minecraft 互動模組 (Chaos Bridge)

- **目標**: 觀眾抖內 Bits 可以召喚怪物、給予實況主道具或施加狀態效果（中毒/加速）。
- **技術**: 開發 Spigot/Paper 伺服器插件，透過 WebSocket 連接本平台後端。

#### Story 10.2 – 投票干涉系統 (Vote to Interfere)

- **目標**: 聊天室即時投票決定遊戲走向（例如：左轉/右轉，善良/邪惡選項）。
- **技術**: 提供通用 API 供遊戲開發者或 Modder 串接。

---

## Epic 11: AI 智慧助手 (AI Co-host & Moderation)

### 概念

引入大語言模型 (LLM) 技術，讓平台不只是機械式的工具，而具備「理解」與「對話」的能力，扮演實況主的虛擬搭檔。

### 潛在 Stories

#### Story 11.1 – AI 聊天伴侶 (The Co-host)

- **目標**: 當聊天室冷場時，AI 自動根據遊戲畫面或當下話題拋出梗或問題，活絡氣氛。
- **技術**: 整合 OpenAI/Claude API，結合 STT (語音轉文字) 監聽實況主說話內容。

#### Story 11.2 – 語意理解版主 (Context-aware Mod)

- **目標**: 辨識「高級酸」或「陰陽怪氣」的言論，而不僅僅是過濾髒字。理解上下文（Context）來判斷是否違規。
- **技術**: 使用 LLM 進行情感分析與意圖識別。

#### Story 11.3 – 智慧精華摘要 (Auto Summarizer)

- **目標**: 下播後自動生成「今日直播懶人包」文字摘要，發布到 Discord 或推特。
- **技術**: 分析聊天室熱點與字幕紀錄 (Transcript)。
