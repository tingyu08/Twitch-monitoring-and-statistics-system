# CI 與部署／遷移備忘（CI & Deployment Notes）

本文件補充 `docs/dev-setup.md`
中的第 5、6 章，提供更具體的最小可行 CI 與部署／遷移注意事項，作為未來 Architect / Dev /
Ops 設計正式流程時的起點。

---

## 1. 最小 CI 流程建議

以 GitHub Actions 為例，建議先建立一個簡單的 `ci.yml`：

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Use Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "18"

      - name: Install dependencies
        run: npm install

      - name: Lint & Test frontend
        run: |
          cd frontend
          npm run lint
          npm test -- --watch=false

      - name: Lint & Test backend
        run: |
          cd backend
          npm run lint
          npm test -- --watch=false
```

> 實際 scripts 名稱需與之後建立的 `package.json` 對齊。  
> 若採 monorepo + workspace，可先在 root 執行一次 `npm test` 即可涵蓋前後端。

---

## 2. Migration 與部署順序

> 詳細 DB Schema 請依日後 ORM / Migration 工具定義，這裡只規範「順序」與「原則」。

### 2.1 部署前步驟

1. 在 dev / staging 上先執行 migration：
   - Prisma：`npx prisma migrate deploy`
   - TypeORM：`npm run typeorm migration:run`
2. 跑一輪自動化測試（至少核心單元與基礎整合測試）。
3. 確認主要儀表板查詢與排程 Job 在 staging 正常運行。

### 2.2 正式部署順序

1. **DB Migration**（不可省略）
2. **後端 API + Job** 新版本部署
   - 確保對舊版前端仍然相容（避免 breaking API）。
3. **前端** 新版部署
   - 例如 Vercel / 自建 Node 容器。

必要時可在 Deployment Pipeline 中明確拆成兩個 job：`migrate` 與 `deploy`，中間插入 smoke test。

---

## 3. Rollback 策略（高層）

1. **前端回滾**
   - 使用部署平台內建「回滾上一版」功能（如 Vercel / Netlify）。
2. **後端回滾**
   - 保留上一版映像檔或部署設定，必要時快速切回。
3. **資料層回滾**
   - 能逆轉的 migration（新增欄位）可直接 rollback；
   - 無法逆轉的 destructive migration 必須先備份資料庫快照，再由 DBA / Ops 評估還原。

> 在 MVP 階段，建議盡可能避免 destructive migration，以新增欄位／表為主。

---

## 4. 與 BMad / QA 任務的關聯

- QA Agent 在執行 `risk-profile` / `nfr-assess` / `review-story` 任務時，可以引用本文件做為：
  - 部署風險與 rollback 準備程度的判斷基準。
  - 對 CI 覆蓋度（是否至少有 lint + test）的快速確認清單。
- 若未來 CI / 部署流程有重大變動，請同步更新本文件，並在對應的 QA 文檔（Gate / Risk /
  NFR）中註明版本或依據。
