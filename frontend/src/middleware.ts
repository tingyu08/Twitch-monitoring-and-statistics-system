import createMiddleware from "next-intl/middleware";
import { locales, defaultLocale } from "./i18n";

export default createMiddleware({
  // 支援的語言列表
  locales,
  // 預設語言
  defaultLocale,
  // 使用前綴策略：始終在 URL 中顯示語言前綴
  localePrefix: "as-needed",
});

export const config = {
  // 匹配所有路由，排除 API 路由、靜態檔案等
  matcher: [
    // 匹配所有頁面路由
    "/((?!api|_next|_vercel|.*\\..*).*)",
    // 也匹配根路由
    "/",
  ],
};
