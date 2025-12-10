# E2E 測試實作指南

## 目前狀態

###  已完成
- Playwright 安裝與設定
- Chromium 瀏覽器安裝
- 測試基礎架構建立
- 3 個測試檔案 (14 個測試案例)
- 自動化測試腳本

###  測試結果
- **通過**: 4/14 tests (28.5%)
  -  登入頁面顯示測試
  -  登入按鈕無障礙測試
  -  認證載入狀態測試
  -  資料載入狀態測試

- **待調整**: 9/14 tests (64.3%)
  - 需要根據實際 UI 實作調整選擇器
  - 儀表板內容選擇器
  - 使用者資訊顯示選擇器
  - 圖表元素選擇器

## 測試檔案結構

```
frontend/
 e2e/
    auth.spec.ts              # 認證流程測試 (4 tests)
    dashboard-navigation.spec.ts  # 儀表板導航 (3 tests)
    dashboard-charts.spec.ts      # 圖表互動測試 (7 tests)
    README.md                 # 測試說明文件
 playwright.config.ts          # Playwright 設定
 package.json                  # 新增 E2E 測試腳本
```

## 執行測試

### 基本命令
```bash
# 執行所有 E2E 測試
npm run test:e2e

# UI 模式 (互動式測試)
npm run test:e2e:ui

# Debug 模式
npm run test:e2e:debug

# 查看測試報告
npm run test:e2e:report
```

### 進階使用
```bash
# 執行特定測試檔案
npx playwright test auth.spec.ts

# 有頭模式 (看到瀏覽器)
npx playwright test --headed

# 僅執行失敗的測試
npx playwright test --last-failed
```

## 測試策略

### 1. Mock 認證
所有測試使用 mock 認證避免真實 OAuth:
```typescript
await context.addCookies([{
  name: 'twitch-session',
  value: 'mock-session-token',
  // ...
}]);

await page.route('**/api/auth/me', async route => {
  await route.fulfill({
    status: 200,
    body: JSON.stringify({ userId: 'test-user' })
  });
});
```

### 2. API Mocking
攔截所有外部 API 呼叫:
- `/api/auth/me` - 使用者資料
- `/api/streamer/summary` - 統計摘要
- `/api/streamer/time-series` - 時間序列資料
- `/api/streamer/heatmap` - 熱力圖資料

### 3. 選擇器優先順序
1. **Role-based**: `getByRole('button', { name: /login/i })`
2. **Text-based**: `getByText(/Dashboard/i)`
3. **Test ID**: `getByTestId('chart-container')`
4. **CSS**: `page.locator('.recharts-surface')` (最後選擇)

## 下一步工作

### 短期 (本週)
1. **調整儀表板測試選擇器**
   - 檢查實際 DOM 結構
   - 更新選擇器匹配實際元素
   - 確保測試穩定性

2. **新增 data-testid 屬性**
   - 在關鍵 UI 元素添加 test ID
   - 提高測試可靠性
   - 減少選擇器脆弱性

3. **完善圖表測試**
   - 驗證 Recharts SVG 結構
   - 測試動畫效果
   - 測試互動行為

### 中期 (下週)
1. **新增更多測試案例**
   - 錯誤邊界測試
   - 效能測試
   - 無障礙測試

2. **視覺回歸測試整合**
   - 考慮 Playwright 截圖比對
   - 或整合 Percy/Chromatic

3. **CI/CD 整合**
   - GitHub Actions 設定
   - 自動化測試執行
   - 測試報告產生

## 最佳實踐

###  應該做
- 使用有意義的測試描述
- Mock 所有外部依賴
- 使用適當的等待策略
- 測試使用者行為,非實作細節
- 保持測試獨立性

###  不應該做
- 依賴固定等待時間
- 使用過於具體的 CSS 選擇器
- 測試內部狀態
- 在測試間共享狀態
- 忽略無障礙性

## 故障排除

### 測試逾時
```typescript
// 增加單一測試的逾時時間
test('slow test', async ({ page }) => {
  test.setTimeout(60000);
  // ...
});
```

### 元素找不到
```typescript
// 等待網路閒置
await page.waitForLoadState('networkidle');

// 使用明確等待
await expect(element).toBeVisible({ timeout: 10000 });

// 使用 .or() 提供備選
const button = page.getByRole('button').or(page.locator('button'));
```

### Debug 技巧
```bash
# 視覺化 debug
npm run test:e2e:ui

# 查看失敗截圖
test-results/[test-name]/test-failed-1.png

# 查看追蹤檔案
npx playwright show-trace test-results/[test-name]/trace.zip
```

## 效益評估

### 已完成
-  E2E 測試基礎設施 (4-6 小時投入)
-  14 個測試案例框架
-  自動化測試流程
-  完整文件

### 預期效益
-  自動化關鍵使用者流程驗證
-  減少手動測試時間
-  提早發現整合問題
-  提升部署信心

### ROI
- **投入時間**: ~6 小時 (設定 + 初始測試)
- **預期節省**: 每次發布節省 2-3 小時手動測試
- **回收週期**: ~3 次發布後開始正向回報

## 相關文件
- [E2E 測試 README](frontend/e2e/README.md)
- [Playwright 設定](frontend/playwright.config.ts)
- [測試策略](TEST-GUIDE.md)