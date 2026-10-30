// Jest setup file
// Mocks for global objects if needed
jest.setTimeout(30000); // 增加 Timeout 避免測試過早失敗

// 設置測試環境變數
process.env.VIEWER_TOKEN_ENCRYPTION_KEY = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcyEhISE='; // 32 bytes base64
process.env.APP_JWT_SECRET = 'test-jwt-secret-key';
process.env.TWITCH_CLIENT_ID = 'test_client_id';
process.env.TWITCH_CLIENT_SECRET = 'test_client_secret';
// 改用 PostgreSQL 後 db/prisma.ts 沒有 DATABASE_URL 會在載入時 throw（SQLite 時代會退回本機檔），
// 連帶讓所有 import 它的測試檔整個載入失敗。PrismaPg 要到第一次查詢才連線，給個不存在的位址即可；
// 真的需要資料庫的整合測試請自行設定（例如 TEST_POSTGRES_URL）
process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:1/test';
