-- 優化 update-live-status job 的 groupBy isLive 計數查詢
-- 原本需要 2 次 COUNT 查詢，合併為 1 次 groupBy 後此索引可加速過濾
CREATE INDEX IF NOT EXISTS "channels_isMonitored_isLive_idx" ON "channels"("isMonitored", "isLive");
