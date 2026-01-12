"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getStreamerVideos,
  getStreamerClips,
  type StreamerVideo,
  type StreamerClip,
} from "@/lib/api/streamer";

export default function VideosPage() {
  const t = useTranslations("streamer");
  const [activeTab, setActiveTab] = useState<"videos" | "clips">("videos");

  // Videos State
  const [videos, setVideos] = useState<StreamerVideo[]>([]);
  const [videosPage, setVideosPage] = useState(1);
  const [videosTotalPages, setVideosTotalPages] = useState(1);
  const [loadingVideos, setLoadingVideos] = useState(false);

  // Clips State
  const [clips, setClips] = useState<StreamerClip[]>([]);
  const [clipsPage, setClipsPage] = useState(1);
  const [clipsTotalPages, setClipsTotalPages] = useState(1);
  const [loadingClips, setLoadingClips] = useState(false);

  useEffect(() => {
    if (activeTab === "videos") {
      setLoadingVideos(true);
      getStreamerVideos(videosPage)
        .then((res) => {
          setVideos(res.data);
          setVideosTotalPages(res.totalPages);
        })
        .finally(() => setLoadingVideos(false));
    } else {
      setLoadingClips(true);
      getStreamerClips(clipsPage)
        .then((res) => {
          setClips(res.data);
          setClipsTotalPages(res.totalPages);
        })
        .finally(() => setLoadingClips(false));
    }
  }, [activeTab, videosPage, clipsPage]);

  const handleTabChange = (tab: "videos" | "clips") => {
    setActiveTab(tab);
    if (tab === "videos") setVideosPage(1);
    else setClipsPage(1);
  };

  return (
    <div className="container px-4 py-8 mx-auto max-w-7xl animate-in fade-in zoom-in-95 duration-500">
      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-bold theme-text-gradient">
          {t("videosLibrary")}
        </h1>
        <p className="theme-text-secondary text-lg">{t("videosLibraryDesc")}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-gray-200 dark:border-gray-700 mb-6 font-medium">
        <button
          className={`px-6 py-3 transition-colors border-b-2 ${
            activeTab === "videos"
              ? "border-purple-500 text-purple-600 dark:text-purple-400"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
          }`}
          onClick={() => handleTabChange("videos")}
        >
          Latest VODs
        </button>
        <button
          className={`px-6 py-3 transition-colors border-b-2 ${
            activeTab === "clips"
              ? "border-purple-500 text-purple-600 dark:text-purple-400"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
          }`}
          onClick={() => handleTabChange("clips")}
        >
          Top Clips
        </button>
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {activeTab === "videos" ? (
          // Videos List
          loadingVideos ? (
            <div className="col-span-full py-10 text-center text-gray-500">
              Loading Videos...
            </div>
          ) : videos.length === 0 ? (
            <div className="col-span-full py-10 text-center text-gray-500">
              No videos found. Ensure sync job is running.
            </div>
          ) : (
            videos.map((v) => (
              <div
                key={v.twitchVideoId}
                className="group relative bg-white dark:bg-[#1a1b26] rounded-xl overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-1 transition duration-300 border border-gray-100 dark:border-gray-800"
              >
                <a
                  href={v.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <div className="aspect-video relative bg-black">
                    {/* Use standard img for now to avoid remote pattern issues */}
                    <img
                      src={v.thumbnailUrl || ""}
                      alt={v.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded font-mono">
                      {v.duration}
                    </div>
                  </div>
                  <div className="p-4">
                    <h3
                      className="font-medium text-sm line-clamp-2 h-10 mb-2 theme-text-primary group-hover:text-purple-500 transition-colors"
                      title={v.title}
                    >
                      {v.title}
                    </h3>
                    <div className="flex items-center justify-between text-xs theme-text-secondary">
                      <span>{new Date(v.createdAt).toLocaleDateString()}</span>
                      <span className="flex items-center gap-1 font-medium text-purple-500">
                        👁️ {v.viewCount.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </a>
              </div>
            ))
          )
        ) : // Clips List
        loadingClips ? (
          <div className="col-span-full py-10 text-center text-gray-500">
            Loading Clips...
          </div>
        ) : clips.length === 0 ? (
          <div className="col-span-full py-10 text-center text-gray-500">
            No clips found.
          </div>
        ) : (
          clips.map((c) => (
            <div
              key={c.twitchClipId}
              className="group relative bg-white dark:bg-[#1a1b26] rounded-xl overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-1 transition duration-300 border border-gray-100 dark:border-gray-800"
            >
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <div className="aspect-video relative bg-black">
                  <img
                    src={c.thumbnailUrl || ""}
                    alt={c.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded font-mono">
                    {Math.round(c.duration)}s
                  </div>
                </div>
                <div className="p-4">
                  <h3
                    className="font-medium text-sm line-clamp-2 h-10 mb-2 theme-text-primary group-hover:text-purple-500 transition-colors"
                    title={c.title}
                  >
                    {c.title}
                  </h3>
                  <div className="flex items-center justify-between text-xs theme-text-secondary">
                    <span className="line-clamp-1">{c.creatorName}</span>
                    <span className="flex items-center gap-1 font-medium text-purple-500">
                      👁️ {c.viewCount.toLocaleString()}
                    </span>
                  </div>
                </div>
              </a>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      <div className="mt-12 flex justify-center items-center gap-4">
        <button
          disabled={activeTab === "videos" ? videosPage <= 1 : clipsPage <= 1}
          onClick={() =>
            activeTab === "videos"
              ? setVideosPage((p) => p - 1)
              : setClipsPage((p) => p - 1)
          }
          className="px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-800 theme-text-primary rounded-lg disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-white/10 transition shadow-sm"
        >
          Previous
        </button>
        <span className="text-sm font-medium theme-text-secondary">
          Page {activeTab === "videos" ? videosPage : clipsPage}
        </span>
        <button
          disabled={
            activeTab === "videos"
              ? videosPage >= videosTotalPages
              : clipsPage >= clipsTotalPages
          }
          onClick={() =>
            activeTab === "videos"
              ? setVideosPage((p) => p + 1)
              : setClipsPage((p) => p + 1)
          }
          className="px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-800 theme-text-primary rounded-lg disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-white/10 transition shadow-sm"
        >
          Next
        </button>
      </div>
    </div>
  );
}
