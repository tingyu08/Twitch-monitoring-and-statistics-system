"use client";

import { useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { locales, type Locale } from "@/i18n";

const localeNames: Record<Locale, string> = {
  "zh-TW": "繁體中文",
  en: "English",
};

export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();

  const handleChange = (newLocale: Locale) => {
    // 移除當前語言前綴
    const pathWithoutLocale = pathname.replace(
      new RegExp(`^/(${locales.join("|")})`),
      ""
    );
    // 導向新語言路徑
    router.push(`/${newLocale}${pathWithoutLocale || "/"}`);
  };

  return (
    <div className="relative">
      <select
        value={locale}
        onChange={(e) => handleChange(e.target.value as Locale)}
        className="appearance-none bg-white/10 dark:bg-white/5 border border-purple-200 dark:border-white/10 rounded-lg px-3 py-1.5 pr-8 text-sm theme-text-primary cursor-pointer hover:bg-white/20 dark:hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/50"
        aria-label="選擇語言"
      >
        {locales.map((loc) => (
          <option key={loc} value={loc} className="bg-white dark:bg-gray-800">
            {localeNames[loc]}
          </option>
        ))}
      </select>
      {/* 下拉箭頭 */}
      <svg
        className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none theme-text-secondary"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </div>
  );
}

export default LocaleSwitcher;
