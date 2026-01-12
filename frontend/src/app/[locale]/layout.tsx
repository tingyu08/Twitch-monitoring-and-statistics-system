import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { locales, type Locale } from "@/i18n";

import { SocketProvider } from "@/features/socket/SocketProvider";

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  // 驗證 locale
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  // 取得翻譯訊息
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <SocketProvider>{children}</SocketProvider>
    </NextIntlClientProvider>
  );
}
