"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const router = useRouter();

  useEffect(() => {
    // 重導向到隱私設定頁
    router.replace("/settings/privacy");
  }, [router]);

  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-gray-400">正在載入設定...</div>
    </div>
  );
}
