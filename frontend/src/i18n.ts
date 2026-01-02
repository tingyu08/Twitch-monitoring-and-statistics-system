import { notFound } from "next/navigation";
import { getRequestConfig } from "next-intl/server";

// 支援的語言列表
export const locales = ["zh-TW", "en"] as const;
export type Locale = (typeof locales)[number];

// 預設語言
export const defaultLocale: Locale = "zh-TW";

export default getRequestConfig(async ({ requestLocale }) => {
  // 取得請求的語言
  let locale = await requestLocale;

  // 驗證 locale 是否有效
  if (!locale || !locales.includes(locale as Locale)) {
    locale = defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
