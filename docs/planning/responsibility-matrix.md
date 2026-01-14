# Twitch 實況監控與統計平台 – 責任分工矩陣（Responsibility Matrix）

本文件說明「人類角色」與各類 BMad Agent / 系統在本專案中的主要責任分工，協助之後的開發、測試與營運協作。

---

## 1. 角色列表

| 角色/Agent        | 簡述                                                                 |
|-------------------|----------------------------------------------------------------------|
| Product Manager   | 撰寫/維護 PRD、產品策略與 Roadmap                                   |
| Product Owner (PO)| 維護 Epics / Stories、一致性與 MVP 範圍、文件品質                   |
| Scrum Master (SM) | Story 流程管理、拆解與準備、衝刺節奏                                |
| Architect         | 系統 / 前後端 / 資料架構設計與演進                                  |
| Dev Agent         | 依 Story 實作程式碼與測試，只更新 Story 中允許區塊                 |
| QA Agent          | 依 QA 任務檢查品質、產出 Gate / Risk / NFR / Trace 等評估文件      |
| Human Dev         | 撰寫與維護實際程式碼、Infra、DevOps                                 |
| Ops / SRE         | 部署、監控、Incident 處理與 SLO 維護                               |

---

## 2. 需求與文件責任

| 項目                      | PM | PO | SM | Architect | Dev Agent | QA Agent | Human Dev | 備註                                   |
|---------------------------|----|----|----|-----------|-----------|----------|-----------|----------------------------------------|
| Project Brief             | R  | C  | C  | C         | I         | I        | I         | PM 主導，PO/Architect 共同參與        |
| PRD（`docs/prd.md`）      | R  | C  | C  | C         | I         | I        | I         | PM 撰寫與維護                          |
| Architecture Docs         | C  | C  | I  | R         | I         | I        | C         | Architect 主導                         |
| Front-end Spec            | C  | R  | I  | C         | I         | I        | C         | PO + UX 負責，前端參與                 |
| Epics（epic-*.md）        | C  | R  | C  | C         | I         | I        | I         | PO 負責範圍與目標                      |
| Stories（`docs/stories`） | C  | R  | R  | C         | I         | I        | I         | SM/PO 合作產出，Dev/QA 僅讀            |
| Dev Setup / Dev Docs      | C  | R  | C  | C         | I         | I        | R         | `docs/dev-setup.md` 由 PO+Dev 維護    |
| QA / Risk / NFR Docs      | I  | C  | I  | C         | I         | R        | I         | QA Agent 主導                          |

> R = Responsible, C = Consulted, I = Informed

---

## 3. 開發與程式碼責任

| 項目                             | PM | PO | SM | Architect | Dev Agent | Human Dev | 備註                                             |
|----------------------------------|----|----|----|-----------|-----------|-----------|--------------------------------------------------|
| 選擇技術棧 / 架構                | I  | C  | I  | R         | I         | C         | 以 `fullstack-architecture.md` 為準             |
| 專案初始化 / 腳手架              | I  | C  | I  | C         | I         | R         | Human Dev 建立 repo / boilerplate                |
| 撰寫後端程式碼 / Job / DB Schema | I  | I  | I  | C         | R         | R         | Dev Agent 與 Human Dev 依 Story 實作             |
| 撰寫前端程式碼                   | I  | C  | I  | C         | R         | R         | 依 `front-end-architecture.md` 與 UI Spec        |
| Story 檔內「Dev Agent Record」   | I  | I  | I  | I         | R         | I         | 僅 Dev Agent 更新 Story 指定區段                 |
| Story 內容（Story/AC/Dev Notes） | C  | R  | R  | C         | I         | I         | Dev Agent 不得修改 Story 主內容                  |

---

## 4. 測試與品質責任

| 項目                                 | PM | PO | SM | Architect | Dev Agent | QA Agent | Human Dev | 備註                                   |
|--------------------------------------|----|----|----|-----------|-----------|----------|-----------|----------------------------------------|
| 測試策略（整體）                     | I  | C  | I  | R         | C         | R        | C         | 由 Architect + QA Agent 主導          |
| 實作單元測試 / 基本整合測試         | I  | I  | I  | C         | R         | C        | R         | Dev Agent/Human Dev 負責               |
| Story 級別的 QA Gate / Review       | I  | C  | I  | C         | I         | R        | I         | 由 QA Agent 執行 `review-story` 等任務|
| 風險評估與 Risk Profile              | I  | C  | I  | C         | I         | R        | I         | 由 QA Agent 依 `risk-profile` 任務產出|
| NFR Assessment / Traceability       | I  | C  | I  | C         | I         | R        | I         | 由 QA Agent 使用 `nfr-assess` / `trace-requirements`|

---

## 5. Infra / 部署與營運責任

| 項目                             | PM | PO | SM | Architect | Dev Agent | QA Agent | Human Dev | Ops/SRE | 備註                                  |
|----------------------------------|----|----|----|-----------|-----------|----------|-----------|---------|---------------------------------------|
| CI（lint + test pipeline）       | I  | C  | I  | C         | C         | C        | R         | C       | 具體定義可見 `docs/dev-setup.md`      |
| Build / Deploy Pipeline          | I  | I  | I  | C         | I         | I        | R         | R       | Human Dev + Ops 負責                  |
| Production 監控與告警            | I  | I  | I  | C         | I         | C        | C         | R       | 與 Story 3.5 / NFR 一致               |
| Incident Response / On-call      | I  | I  | I  | C         | I         | I        | C         | R       | 須另訂 on-call 流程                   |

---

## 6. Twitch / 外部服務相關責任

| 項目                                    | PM | PO | SM | Architect | Dev Agent | Human Dev | 備註                                        |
|-----------------------------------------|----|----|----|-----------|-----------|-----------|---------------------------------------------|
| 申請 Twitch Developer Application       | R  | C  | I  | C         | I         | C         | 通常由 PM/PO 或 Owner 人類帳號操作         |
| 設定 OAuth Redirect URIs                | C  | R  | I  | C         | I         | C         | 需與 Architect/Dev 確認實際 URL            |
| 管理 Client ID / Secret（Secrets）     | I  | I  | I  | C         | I         | R         | 由 Human Dev / Ops 設定於環境變數 / Secret Store |
| API Rate Limit 策略與實作               | I  | I  | I  | R         | R         | C         | 由 Architect 設計，Dev 實作                |

---

## 7. 使用方式說明

- **給 PM / PO / SM**：規劃新需求或調整流程時，可先確認是否違反既定責任邊界（例如不要讓 Dev Agent 去修改 PRD）。  
- **給 Dev / Dev Agent**：遇到文件缺漏或需要額外資訊時，先檢查本表「誰負責」，再回報給正確對象。  
- **給 QA Agent**：在產生 Gate / Risk / NFR 文件時，可引用本表判斷「建議由誰修正」。  

若未來角色或交付物有變更，請同步更新本文件，保持與實際運作一致。


