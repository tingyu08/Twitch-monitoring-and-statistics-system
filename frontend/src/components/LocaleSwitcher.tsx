import { useRouter, usePathname, useParams } from "next/navigation";
import { locales, type Locale } from "@/i18n";
import { useTransition } from "react";
import { Globe } from "lucide-react";

const localeNames: Record<Locale, string> = {
  "zh-TW": "繁體中文",
  en: "English",
};

export default function LocaleSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [isPending, startTransition] = useTransition();

  // 取得當前的 locale
  const currentLocale = (params.locale as string) || "zh-TW";

  const handleChange = (nextLocale: Locale) => {
    startTransition(() => {
      // 替換路徑中的 locale
      // 例如 /zh-TW/some-page -> /en/some-page
      // 或者 /some-page (預設) -> /en/some-page

      let newPath = pathname;
      const segments = pathname.split("/");

      // 檢查第一個 segment 是否為 locale (因為 pathname 開頭是 /所以是 segments[1])
      const pathLocale = segments[1] as Locale | undefined;

      if (pathLocale && locales.includes(pathLocale)) {
        // 如果原本路徑有 locale，替換它
        segments[1] = nextLocale;
        newPath = segments.join("/");
      } else {
        // 如果原本路徑沒有 locale (是預設語言)，加上去
        newPath = `/${nextLocale}${pathname}`;
      }

      router.push(newPath);
    });
  };

  return (
    <div className="relative">
      <Globe className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none theme-text-secondary" />
      <select
        value={currentLocale}
        onChange={(e) => handleChange(e.target.value as Locale)}
        className="appearance-none bg-white/10 dark:bg-white/5 border border-purple-200 dark:border-white/10 rounded-lg py-1.5 pl-8 pr-8 text-sm theme-text-primary focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer"
        disabled={isPending}
        aria-label="切換語言"
      >
        {locales.map((loc) => (
          <option
            key={loc}
            value={loc}
            className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
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
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}
