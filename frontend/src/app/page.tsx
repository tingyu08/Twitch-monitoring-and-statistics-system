import { redirect } from "next/navigation";
import { defaultLocale } from "@/i18n";

// 根路由重定向到預設語言
export default function RootPage() {
  redirect(`/${defaultLocale}`);
}
