// Jest setup file
// Mocks for global objects if needed
jest.setTimeout(30000); // 增加 Timeout 避免測試過早失敗

// 設置測試環境變數
process.env.VIEWER_TOKEN_ENCRYPTION_KEY = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcyEhISE='; // 32 bytes base64
process.env.APP_JWT_SECRET = 'test-jwt-secret-key';
process.env.TWITCH_CLIENT_ID = 'test_client_id';
process.env.TWITCH_CLIENT_SECRET = 'test_client_secret';
