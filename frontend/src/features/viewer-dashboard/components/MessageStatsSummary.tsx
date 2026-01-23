import { MessageStatsSummary as SummaryType } from "@/lib/api/viewer";
import { MessageSquare, Calendar, ChevronRight, Hash } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";
import { useTranslations, useLocale } from "next-intl";

interface MessageStatsSummaryProps {
  summary: SummaryType;
  isLoading?: boolean;
}

export function MessageStatsSummary({ summary, isLoading }: MessageStatsSummaryProps) {
  const t = useTranslations();
  const locale = useLocale();
  const dateLocale = locale === "zh-TW" ? zhTW : enUS;

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-xl border bg-card text-card-foreground shadow p-6 animate-pulse h-32"
          />
        ))}
      </div>
    );
  }

  const items = [
    {
      title: t("stats.totalMessages"),
      value: summary.totalMessages.toLocaleString(),
      icon: MessageSquare,
      description: t("stats.totalInPeriod"),
    },
    {
      title: t("stats.avgPerStream"),
      value: summary.avgMessagesPerStream.toLocaleString(),
      icon: Hash,
      description: t("stats.avgInteractionsDesc"),
    },
    {
      title: t("stats.mostActiveDate"),
      value: summary.mostActiveDate || "-",
      icon: Calendar,
      description: summary.mostActiveDate
        ? `${summary.mostActiveDateCount} ${t("stats.messagesUnit")}`
        : t("stats.noData"),
    },
    {
      title: t("stats.recentMessage"),
      value: summary.lastMessageAt
        ? formatDistanceToNow(new Date(summary.lastMessageAt), {
            addSuffix: true,
            locale: dateLocale,
          })
        : "-",
      icon: ChevronRight,
      description: summary.lastMessageAt
        ? new Date(summary.lastMessageAt).toLocaleString(locale)
        : "",
    },
  ];

  return (
    <section
      className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
      aria-label="Message Statistics Summary"
    >
      {items.map((item, index) => (
        <div key={index} className="rounded-xl border bg-card text-card-foreground shadow">
          <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
            <h3 className="tracking-tight text-sm font-medium">{item.title}</h3>
            <item.icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold">{item.value}</div>
            <p className="text-xs text-muted-foreground">{item.description}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
