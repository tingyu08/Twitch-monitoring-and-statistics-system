# Twitch 實況監控與統計平台 UI/UX Specification

## 1. Introduction

This document defines the user experience goals, information architecture, user flows, and visual design specifications for **Twitch 實況監控與統計平台**'s user interface. It serves as the foundation for visual design and frontend development, ensuring a cohesive, dark-tech themed and user-centered experience for both streamers and viewers.

### 1.1 Overall UX Goals & Principles

#### 1.1.1 Target User Personas

- **實況主（Streamer Analytics User）**  
  - 目標：掌握「長期」與「全局」的開台與訂閱表現，驗證時段 / 內容調整成效。  
  - 特性：對數據有興趣，但不一定是資料科學家；偏好「一眼看到重點，再逐步鑽研」。  

- **重度觀眾 / 頻道管理員（Viewer / Channel Manager）**  
  - 目標：量化自己在某台的投入（觀看時數、互動次數），當作榮耀或活動參考。  
  - 特性：情感投入高，願意看漂亮數據呈現，但不想被複雜操作搞混。  

- **營運 / 社群營運（Ops / Community Manager）**  
  - 目標：對比活動前後、時段調整前後的效果，觀察活躍觀眾變化。  
  - 特性：偏分析導向，需要可以切換區間、比對前後趨勢，重視圖表的可讀性與解釋力。  

#### 1.1.2 Usability Goals

1. **快速上手**：新實況主第一次登入後 **5 分鐘內** 能找到主要儀表板，並看懂核心指標（開台時數、場數、觀看 / 訂閱趨勢）。  
2. **高頻操作效率**：回流實況主在每次登入時，**3–4 個操作內** 就能切換到常用的時間區間與圖表組合（例如：最近 30 天 + 開台熱度圖）。  
3. **數據一眼懂**：透過清楚標題、副標與圖例，讓非資料背景使用者也能理解每張圖代表的意義與單位。  
4. **錯誤與限制易理解**：當 Twitch API 資料有限或延遲時，以明確的 Banner / Tooltip 說明原因與影響，而非靜默失敗。  
5. **跨裝置一致體驗**：手機、平板與桌機皆可完成主要查找與瀏覽行為；差異僅在資訊密度，而不是功能缺失。  

#### 1.1.3 Design Principles

1. **Dark Tech, Clear Data**  
   - 採用暗色系科技風格，但以資料可讀性為優先。深色背景搭配高對比文字與清楚的資料視覺層級，避免炫光干擾閱讀。  

2. **Chart-First Layout**  
   - 儀表板版面優先留給圖表與關鍵指標卡片，說明文字與控制元件（篩選器、日期選擇）相對退居次要位置，不搶視覺焦點。  

3. **Progressive Disclosure（循序揭露）**  
   - 首屏僅顯示 3–5 個關鍵指標與圖表，其餘進階細節放在展開區或次層頁，避免首次進入時資訊過載。  

4. **Consistent Interaction Patterns**  
   - 篩選器、日期區間、Tab、卡片操作等互動樣式全站統一：同一種操作永遠長得一樣、出現在相似位置。  

5. **Accessible by Default**  
   - 遵循 WCAG 2.1 AA 精神：足夠對比、鍵盤可操作、圖表具備文字敘述，顏色不是唯一資訊來源。  

6. **Responsive & Motion-Safe**  
   - 以 mobile-first 為基準設計版面，再延伸到桌機。動效以功能導向的微互動為主（hover feedback、載入 skeleton、filter 切換過渡），避免過度炫技的動畫。  

---

## 2. Information Architecture & Page Layout

### 2.1 Key Surfaces / Screens

#### 2.1.1 Landing Page（公開首頁）

**目標**：說明產品價值，分別引導實況主與觀眾登入。  

- **Hero 區**  
  - 標題：簡潔描述「Twitch 實況監控與統計平台」。  
  - 副標：強調「長期儀表板」、「觀眾足跡」、「合法官方 API」。  
  - 主要 CTA：**[以 Twitch 登入]**（Primary 按鈕）。  
  - 次要 CTA：連到「了解更多」或示範影片 / 截圖。  

- **功能簡介區**  
  - 三到四張 icon + 文案卡片，分別介紹：  
    - 實況主長期營運儀表板  
    - 觀眾個人觀影與互動統計  
    - 資料收集與隱私保護  

- **視覺示意區**  
  - 一張或多張暗色科技風儀表板截圖，展示關鍵圖表與卡片樣式。  

- **Footer / 法務區**  
  - 隱私權政策、使用條款、資料來源（官方 Twitch API）說明。  

#### 2.1.2 Streamer Dashboard（實況主儀表板）

**目標**：一眼掌握長期開台與訂閱表現（Epic 1、FR-S1–S5）。  

- **全域篩選列（頂部）**  
  - 時間區間選擇：快捷（最近 7 / 30 / 90 天）＋自訂日期範圍。  
  - 頻道名稱 / Twitch 帳號標示。  
  - 快速篩選（如：只看「平日」或「周末」）。  

- **Summary Cards 區**（採用 responsive grid）  
  - 卡片 1：總開台時數  
  - 卡片 2：總開台場數  
  - 卡片 3：平均單場長度  
  - 卡片 4：訂閱概要（若 API 可行，顯示訂閱總數 / 變化；若不完整，顯示「估算值」 Badge）  

- **圖表區**  
  - 「開台時間分布與頻率」圖表（折線 / 長條圖）。  
  - 一週時段 Heatmap（橫軸：星期；縱軸：時段）。  
  - 訂閱數變化趨勢圖（API 限制時於圖上顯示提示 Banner 或 Badge）。  

- **偏好設定區（可摺疊）**  
  - 列表勾選欲顯示 / 隱藏的卡片與圖表。  
  - 用戶偏好儲存在 localStorage 或使用者設定中。  

#### 2.1.3 Viewer Dashboard（觀眾儀表板）

**目標**：讓觀眾看到自己的長期投入與榮耀感（Epic 2、FR-V1–V5）。  

- **頂部區**  
  - 顯示目前登入的 Twitch 身份。  
  - 實況主選擇器：搜尋 / 下拉選單選取目標頻道。  

- **Summary Cards 區**  
  - 指定實況主的累積觀看時數。  
  - 指定期間內的留言 / 互動次數。  
  - 平均每月觀看時數與留言數。  

- **圖表與足跡區**  
  - 近 7 / 30 / 90 天觀看時數趨勢圖。  
  - 互動次數圖表（bar chart；視 API 能力拆分訊息數 / 表情數）。  
  - 足跡總覽區：時間線或卡片呈現「加入時間、高峰月份、重要活動里程碑」。  

- **隱私與控制區**  
  - 明確的「刪除 / 匿名化資料」按鈕。  
  - 彈出對話框說明刪除後果與不可復原性。  

#### 2.1.4 Auth & Settings

- **登入 / 授權頁**  
  - 單一明確 CTA：以 Twitch 登入。  
  - 概述將存取的資料範圍與用途，顯示與官方 Twitch OAuth 一致的流程。  

- **帳號與偏好設定**  
  - 實況主：預設時間區間、顯示圖表預設組合等。  
  - 觀眾：資料保存期限、隱私選項、是否參與未來實驗功能。  

---

## 3. Visual Style – Dark Tech Dashboard

### 3.1 Overall Look & Feel

- **基調**：深色背景、低飽和冷色系為主體，搭配高亮度 accent 色標註重點。  
- **質感**：適度使用玻璃擬態 / 半透明卡片（background blur + 低透明度），營造科技感；主要內容區的文字與數據區塊應保持實心背景以確保可讀性。  
- **對比度**：所有文本與關鍵 UI 元件須達到 WCAG 2.1 AA 對比度要求。  

### 3.2 Color Palette

> 實際 hex 可在設計階段微調，此處為前端與設計的基準建議。

| Color Type | Hex       | Usage                                                                 |
|-----------|-----------|-----------------------------------------------------------------------|
| Primary   | `#6366F1` | 主要 CTA 按鈕、關鍵圖表主線色、選取狀態                               |
| Secondary | `#22D3EE` | 次要按鈕、hover 狀態、次要圖表線條                                   |
| Accent    | `#F97316` | 活動 / 高亮標記、警示趨勢、Badge                                     |
| Success   | `#4ADE80` | 正向成長、成功訊息                                                   |
| Warning   | `#FACC15` | 需注意但非錯誤的提醒                                                 |
| Error     | `#F97373` | 錯誤、失敗、刪除動作                                                 |
| Neutral   | 多組      | 背景、邊框、文字階層（見下方說明）                                   |

**Neutral / Background 建議**

- App 主背景：`#020617`（深藍黑）  
- 主內容區背景：在主背景上疊一層略亮的區塊 + 細邊框（如 `#1F2937`）。  
- 卡片背景：`#020617` 搭配 `rgba(148,163,184,0.25)` 邊框或陰影。  
- 文字：  
  - 標題文字：`#F9FAFB`  
  - 內文 / 次要文字：`#CBD5F5`  
  - 較弱提示 / placeholder：`#6B7280`  

**使用準則**

- Primary button：實心 Primary 背景 + 白字，hover 時略微提亮背景並增加陰影。  
- Secondary button：實心 Secondary 或 outline Primary。  
- 圖表：  
  - 實況主相關數據使用 Primary / Success 系列。  
  - 觀眾相關數據使用 Secondary / Accent 系列，以免與實況主圖表混淆。  

### 3.3 Typography

- **Primary Font**：幾何無襯線字體，如 Inter / SF Pro / Noto Sans（實際依技術棧選擇）。  
- **Secondary Font**：同系無襯線系列，用於英文 / 數字結構一致。  
- **Monospace**：用於顯示時間戳或技術資訊（可選）。  

建議層級（示例）：

| Element | Size   | Weight | Line Height |
|--------|--------|--------|------------|
| H1     | 32px   | 700    | 120%       |
| H2     | 24px   | 600    | 130%       |
| H3     | 20px   | 600    | 130%       |
| Body   | 14–16px| 400    | 150%       |
| Small  | 12px   | 400    | 150%       |

### 3.4 Iconography & Spacing

- 使用線性 icon（outline style），顏色以 Neutral + Primary 點綴。  
- Icon 應搭配文字，不作為唯一資訊來源。  
- 建議 spacing scale：4 / 8 / 12 / 16 / 24 / 32 / 40 / 64 px，用於 padding / margin / grid 間距。  

---

## 4. Component Design

### 4.1 Layout Components

- **`AppShell`**  
  - 負責整體框架（Header + Sidebar + Content）。  
  - 控制響應式行為（桌機顯示側邊欄、行動裝置使用 Drawer）。  

- **`DashboardSection`**  
  - 每個儀表板區塊的容器，包含標題、副標、右側操作（例如「更多篩選」按鈕）。  

### 4.2 Data Components

- **`StatCard`**  
  - 結構：標題、簡短說明、主數值、副標（相較上一期間的成長百分比與上下箭頭）。  
  - 狀態：  
    - loading：使用 skeleton placeholder。  
    - normal：顯示資料。  
    - degraded：資料不完整時，以 Warning / Info 標記。  

- **`TimeSeriesChart`**  
  - 用於開台時數、觀看時數、訂閱變化等；支援主線 / 次線、tooltip、legend。  

- **`HeatmapChart`**  
  - 用於顯示一週內各時段的開台頻率或觀看熱度。  
  - color scale 與圖例需清楚標示。  

### 4.3 Input & Filter Components

- **`DateRangePicker`**  
  - 基本區間快捷（7 / 30 / 90 天）＋自訂日期。  
  - 狀態切換需帶有簡短過渡動畫，避免閃爍。  

- **`ChannelSelector` / `StreamerSelector`**  
  - 提供搜尋 + 下拉建議；在小螢幕上可全螢幕選擇。  

- **`ChipFilter` / `ToggleGroup`**  
  - 用於切換「指標類型」或「視圖模式」，例如「開台 / 訂閱 / 留言」。  

### 4.4 Feedback Components

- **`Banner`（Info / Warning / Error）**  
  - 用於告知 Twitch API 限制、資料估算、服務狀態等。  

- **`EmptyState`**  
  - 無資料時顯示說明文字與引導操作（例如請用戶先綁定頻道）。  

- **`SkeletonLoader`**  
  - 圖表與卡片在資料尚未載入完成前使用 skeleton，避免空白跳動。  

---

## 5. Interaction, Animation & Micro-interactions

### 5.1 Motion Principles

- 動畫時間以 **200–250ms** 為主；使用 `ease-out` 或 `ease-in-out`。  
- 以「提供回饋」為目的，而非純視覺炫技。  
- 避免大面積、長時間的閃爍與高對比閃動效果。  

### 5.2 Key Interactions

- **Hover / Focus 狀態**  
  - 卡片 / 按鈕 hover 時略微提亮背景並增加陰影；focus 時使用明顯的 focus ring（可用 Secondary 色）。  

- **篩選 / 日期切換**  
  - 切換時採用：舊內容淡出，新內容淡入。  
  - 關鍵數字可使用輕微的數字滾動效果，但應控制在 300ms 內。  

- **圖表 Tooltip**  
  - 滑鼠或觸控 hover 時顯示清楚的 tooltip，包含時間、數值與單位。  
  - 當滑動圖表時 tooltip 不應過度閃爍。  

- **載入狀態**  
  - 初次開啟儀表板時顯示 skeleton；資料回來後平滑切換。  

---

## 6. Responsiveness Strategy

### 6.1 Breakpoints（建議）

| Breakpoint | Min Width | Max Width | Target Devices                 |
|-----------|-----------|-----------|--------------------------------|
| Mobile    | 0px       | 640px     | 手機縱向                       |
| Tablet    | 641px     | 1024px    | 平板、較小筆電                 |
| Desktop   | 1025px    | 1440px    | 一般桌機 / 筆電                |
| Wide      | 1441px    | -         | 大螢幕、外接顯示器             |

### 6.2 Layout Adaptations

- **Mobile**  
  - 移除固定 Sidebar，改用漢堡選單 + Drawer。  
  - Summary Cards 垂直堆疊，圖表以單欄呈現。  
  - 優先顯示 Summary Cards + 1–2 張關鍵圖表，其餘以 Accordion / Tabs 收合。  

- **Tablet**  
  - Summary Cards 採 2 欄 grid。  
  - 圖表可在空間允許時並排兩張，否則維持單欄。  

- **Desktop**  
  - 固定 Sidebar + 上方 Header。  
  - Summary Cards 3–4 欄 grid。  
  - 主要圖表兩欄並排，輔助圖表置於下方或右側。  

- **Wide**  
  - 可額外展示對比圖表或輔助視圖（例如雙時段對比）。  

---

## 7. Accessibility Considerations

- **色彩對比**：所有文字與互動元件均應滿足 WCAG 2.1 AA 對比度標準。  
- **鍵盤操作**：主要操作（切換區間、切換圖表、展開詳細資料）必須可透過鍵盤完成。  
- **圖表敘述**：每張圖表需有簡短的文字說明（例如：「本圖顯示最近 30 天的開台時數變化。」）。  
- **非顏色提示**：上升 / 下降趨勢除顏色外，輔以 icon（▲ / ▼）或文字。  

---

## 8. Summary & Next Steps

本文件提供了 Twitch 實況監控與統計平台的初版 UI/UX 規格，涵蓋：

- 暗色系科技風的整體視覺風格與色彩方案  
- 實況主 / 觀眾雙儀表板的主要頁面佈局與資訊階層  
- 關鍵元件（Stat Cards、圖表、篩選器等）與互動行為  
- 響應式布局策略與基本無障礙考量  

**下一步建議：**

1. 與 PM / Dev 針對此規格進行一次審閱，確認是否符合現階段 MVP 範圍。  
2. 依此規格在 Figma（或其他設計工具）建立具體視覺稿與元件庫。  
3. 前端開發依據本文件與設計稿實作，並與後端 API 合作確認資料結構與 loading 狀態。  


