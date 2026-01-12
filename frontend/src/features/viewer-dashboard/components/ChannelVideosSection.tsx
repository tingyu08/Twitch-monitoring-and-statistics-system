"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { viewerApi } from "@/lib/api/viewer";
import type { StreamerVideo, StreamerClip } from "@/lib/api/streamer";
import Image from "next/image";

interface Props {
  channelId: string;
}

export function ChannelVideosSection({ channelId }: Props) {
  const t = useTranslations("streamer.pages.videos");

  const [activeTab, setActiveTab] = useState<"vods" | "clips">("vods");
  const [videos, setVideos] = useState<StreamerVideo[]>([]);
  const [clips, setClips] = useState<StreamerClip[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        if (activeTab === "vods") {
          const res = await viewerApi.getChannelVideos(channelId, 1, 6);
          if (res) setVideos(res.data);
        } else {
          const res = await viewerApi.getChannelClips(channelId, 1, 6);
          if (res) setClips(res.data);
        }
      } catch (error) {
        console.error("Failed to fetch videos/clips", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [channelId, activeTab]);

  return (
    <div className="theme-card p-6 mb-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold theme-text-gradient flex items-center gap-2">
          {activeTab === "vods" ? (
            <>📺 最近 VOD (7天內)</>
          ) : (
            <>🎬 熱門剪輯 (7天內)</>
          )}
        </h2>

        <div className="flex bg-gray-100 dark:bg-white/5 rounded-lg p-1">
          <button
            onClick={() => setActiveTab("vods")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === "vods"
                ? "bg-white dark:bg-purple-600 text-purple-600 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            VODs
          </button>
          <button
            onClick={() => setActiveTab("clips")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === "clips"
                ? "bg-white dark:bg-purple-600 text-purple-600 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            Clips
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          // Loading Skeletons
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-48 bg-gray-200 dark:bg-white/5 animate-pulse rounded-xl"
            />
          ))
        ) : activeTab === "vods" ? (
          videos.length > 0 ? (
            videos.map((v) => (
              <a
                key={v.twitchVideoId}
                href={v.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative block overflow-hidden rounded-xl bg-gray-100 dark:bg-black/20 border border-gray-200 dark:border-white/5 hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10 transition-all"
              >
                <div className="aspect-video relative">
                  {v.thumbnailUrl ? (
                    <Image
                      src={v.thumbnailUrl
                        .replace("%{width}", "320")
                        .replace("%{height}", "180")}
                      alt={v.title}
                      fill
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full bg-gray-800 flex items-center justify-center text-gray-500 text-xs">
                      No Thumbnail
                    </div>
                  )}
                  <div className="absolute top-2 right-2 bg-black/80 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                    {v.duration}
                  </div>
                </div>
                <div className="p-3">
                  <h3
                    className="font-medium text-sm line-clamp-2 leading-snug group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors"
                    title={v.title}
                  >
                    {v.title}
                  </h3>
                  <div className="mt-2 flex items-center justify-between text-xs theme-text-muted">
                    <span>{new Date(v.createdAt).toLocaleDateString()}</span>
                    <span className="flex items-center gap-1">
                      👁️ {v.viewCount.toLocaleString()}
                    </span>
                  </div>
                </div>
              </a>
            ))
          ) : (
            <p className="col-span-full text-center py-10 theme-text-muted bg-gray-50 dark:bg-white/5 rounded-xl border border-dashed border-gray-200 dark:border-white/10">
              最近 7 天無 VOD 資料
            </p>
          )
        ) : clips.length > 0 ? (
          clips.map((c) => (
            <a
              key={c.twitchClipId}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative block overflow-hidden rounded-xl bg-gray-100 dark:bg-black/20 border border-gray-200 dark:border-white/5 hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10 transition-all"
            >
              <div className="aspect-video relative">
                {c.thumbnailUrl ? (
                  <Image
                    src={c.thumbnailUrl}
                    alt={c.title}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-800 flex items-center justify-center text-gray-500 text-xs">
                    No Thumbnail
                  </div>
                )}
                <div className="absolute top-2 right-2 bg-black/80 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                  {Math.round(c.duration)}s
                </div>
              </div>
              <div className="p-3">
                <h3
                  className="font-medium text-sm line-clamp-2 leading-snug group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors"
                  title={c.title}
                >
                  {c.title}
                </h3>
                <div className="mt-2 flex items-center justify-between text-xs theme-text-muted">
                  <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                  <span className="flex items-center gap-1">
                    👁️ {c.viewCount.toLocaleString()}
                  </span>
                </div>
              </div>
            </a>
          ))
        ) : (
          <p className="col-span-full text-center py-10 theme-text-muted bg-gray-50 dark:bg-white/5 rounded-xl border border-dashed border-gray-200 dark:border-white/10">
            最近 7 天無 Clips 資料
          </p>
        )}
      </div>
    </div>
  );
}
