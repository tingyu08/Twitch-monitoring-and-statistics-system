# .agent 目錄說明

此目錄包含 AI Agent 的配置檔案、技能 (Skills) 和工作流程 (Workflows)。

---

## 📁 目錄結構

```
.agent/
├── README.md          ← 本說明文件
├── skills/            ← 已安裝的 AI Skills (265 個)
└── workflows/         ← 自訂工作流程
```

---

## 🎯 Skills 總覽

我們整合了來自 **8 個頂級來源** 的 **265 個 Skills**，涵蓋軟體開發的各個領域。

### 📦 Skills 來源

| 來源                    | 類型 | 說明                                        |
| ----------------------- | ---- | ------------------------------------------- |
| **Anthropic Official**  | 官方 | 文件處理 (docx, pdf, xlsx, pptx)            |
| **obra/superpowers**    | 社群 | 軟體開發工作流程 (TDD, Debugging, Planning) |
| **wshobson/agents**     | 社群 | 完整 Plugin 生態 (107 skills, 18 plugins)   |
| **VoltAgent/subagents** | 社群 | 100+ 專業子代理                             |
| **skillcreatorai**      | 社群 | 生產力與商業工具                            |
| **wsimmonds**           | 社群 | Next.js 專家包                              |
| **ComposioHQ**          | 社群 | 應用程式整合 (Connect, LangSmith)           |
| **Custom Built**        | 自建 | Shadcn & Tailwind v4 專家指南               |

---

## 🔥 核心 Skills 亮點

### 🛠️ 前端開發

| Skill                             | 功能                             |
| --------------------------------- | -------------------------------- |
| `nextjs-app-router-fundamentals`  | Next.js 13+ App Router           |
| `nextjs-server-client-components` | Server/Client Component 邊界處理 |
| `nextjs-server-actions`           | Server Actions 實作              |
| `vercel-ai-sdk`                   | Vercel AI SDK 整合               |
| `shadcn-expert`                   | Shadcn UI 元件客製化             |
| `tailwind-v4-guide`               | Tailwind CSS v4 新特性           |
| `react-specialist`                | React 18+ 進階模式               |
| `frontend-design`                 | 高品質 UI 設計                   |

### ⚙️ 後端與 API

| Skill                     | 功能                  |
| ------------------------- | --------------------- |
| `backend-developer`       | Express.js 後端開發   |
| `api-designer`            | REST/GraphQL API 設計 |
| `websocket-engineer`      | Socket.IO 即時通訊    |
| `database-design`         | Prisma Schema 設計    |
| `microservices-architect` | 微服務架構            |

### 📊 資料處理

| Skill                | 功能                 |
| -------------------- | -------------------- |
| `csv-summarizer`     | CSV 資料分析         |
| `d3js-visualization` | D3.js 資料視覺化     |
| `xlsx`               | Excel 試算表操作     |
| `jta`                | JSON i18n 多語言翻譯 |

### 🔧 工程流程

| Skill                            | 功能             |
| -------------------------------- | ---------------- |
| `writing-plans`                  | 擬定實作計畫     |
| `executing-plans`                | 執行實作計畫     |
| `systematic-debugging`           | 系統化除錯       |
| `test-driven-development`        | TDD 測試驅動開發 |
| `requesting-code-review`         | PR 前自檢        |
| `verification-before-completion` | 完成前驗證       |

### ☁️ DevOps & 雲端

| Skill                   | 功能         |
| ----------------------- | ------------ |
| `kubernetes-specialist` | K8s 容器編排 |
| `terraform-engineer`    | IaC 基礎設施 |
| `cicd-automation`       | CI/CD 自動化 |
| `cloud-architect`       | 雲端架構設計 |

---

## 💡 使用方式

Skills 會**自動啟用**，只需在對話中提出需求：

```
「幫我升級到 Tailwind v4」      → tailwind-v4-guide
「新增一個 Shadcn Card 元件」   → shadcn-expert
「優化 Next.js Server Actions」 → nextjs-server-actions
「幫我翻譯 i18n 檔案」          → jta
「這個 Bug 怎麼解決？」         → systematic-debugging
「幫我設計這個 API」            → api-designer
「寫一個測試」                  → test-driven-development
```

---

## 📋 Workflows (工作流程)

Workflows 是自訂的步驟式指令，定義如何完成特定任務。
在對話中使用 `/workflow-name` 來觸發對應的工作流程。

### 建立新 Workflow

在 `workflows/` 目錄下建立 `.md` 檔案：

```markdown
---
description: Brief description of what this workflow does
---

# Workflow Name

1. First step
2. Second step
   // turbo ← 自動執行下一步
3. Third step (will auto-run)
```

---

## 📖 參考資源

- [Anthropic Skills](https://github.com/anthropics/skills)
- [obra/superpowers](https://github.com/obra/superpowers)
- [wshobson/agents](https://github.com/wshobson/agents)
- [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents)
- [skillcreatorai/Ai-Agent-Skills](https://github.com/skillcreatorai/Ai-Agent-Skills)
- [wsimmonds/claude-nextjs-skills](https://github.com/wsimmonds/claude-nextjs-skills)
- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)

---

**最後更新**: 2026-01-14
**Skills 總數**: 265 個
