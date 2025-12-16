import { MessageStatsSummary as SummaryType } from "@/lib/api/viewer";
import { MessageSquare, Calendar, ChevronLast, Hash } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";

interface MessageStatsSummaryProps {
  summary: SummaryType;
  isLoading?: boolean;
}

export function MessageStatsSummary({
  summary,
  isLoading,
}: MessageStatsSummaryProps) {
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
      title: "總留言數",
      value: summary.totalMessages.toLocaleString(),
      icon: MessageSquare,
      description: "選定期間內的總計",
    },
    {
      title: "平均每場",
      value: summary.avgMessagesPerStream.toLocaleString(),
      icon: Hash,
      description: "平均每次直播的互動",
    },
    {
      title: "最活躍日期",
      value: summary.mostActiveDate || "-",
      icon: Calendar,
      description: summary.mostActiveDate
        ? `${summary.mostActiveDateCount} 則留言`
        : "無數據",
    },
    {
      title: "最近留言",
      value: summary.lastMessageAt
        ? formatDistanceToNow(new Date(summary.lastMessageAt), {
            addSuffix: true,
            locale: zhTW,
          })
        : "-",
      icon: ChevronLast,
      description: summary.lastMessageAt
        ? new Date(summary.lastMessageAt).toLocaleString("zh-TW")
        : "",
    },
  ];

  return (
    <section
      className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
      aria-label="Message Statistics Summary"
    >
      {items.map((item, index) => (
        <div
          key={index}
          className="rounded-xl border bg-card text-card-foreground shadow"
        >
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
