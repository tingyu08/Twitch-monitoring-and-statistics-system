// Jest setup file - runs before each test file
// Set required environment variables for testing

process.env.APP_JWT_SECRET = "test-secret-key-for-testing";
process.env.VIEWER_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
process.env.TWITCH_REDIRECT_URI = "http://localhost:4000/auth/twitch/callback";
process.env.TWITCH_VIEWER_REDIRECT_URI = "http://localhost:4000/auth/twitch/viewer/callback";
process.env.FRONTEND_URL = "http://localhost:3000";
