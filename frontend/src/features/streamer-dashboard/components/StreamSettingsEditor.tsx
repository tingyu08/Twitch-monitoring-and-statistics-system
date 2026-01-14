"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X, Save, Search, Tag, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface ChannelSettings {
  title: string;
  gameId: string;
  gameName: string;
  tags: string[];
  language: string;
}

interface Game {
  id: string;
  name: string;
  boxArtUrl: string;
}

interface StreamSettingsEditorProps {
  isOpen: boolean;
  onClose: () => void;
}

export function StreamSettingsEditor({
  isOpen,
  onClose,
}: StreamSettingsEditorProps) {
  const t = useTranslations("streamer.settingsEditor");

  const [settings, setSettings] = useState<ChannelSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  // Game search
  const [gameQuery, setGameQuery] = useState("");
  const [gameResults, setGameResults] = useState<Game[]>([]);
  const [searchingGames, setSearchingGames] = useState(false);

  const apiBaseUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

  // Fetch current settings
  useEffect(() => {
    if (!isOpen) return;

    const fetchSettings = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBaseUrl}/api/streamer/settings`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setSettings(data);
        setTitle(data.title || "");
        setSelectedGame(
          data.gameId
            ? { id: data.gameId, name: data.gameName, boxArtUrl: "" }
            : null
        );
        setTags(data.tags || []);
      } catch {
        setError(t("loadError"));
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [isOpen, apiBaseUrl, t]);

  // Search games
  const searchGames = useCallback(
    async (query: string) => {
      if (query.length < 2) {
        setGameResults([]);
        return;
      }

      setSearchingGames(true);
      try {
        const res = await fetch(
          `${apiBaseUrl}/api/streamer/games/search?q=${encodeURIComponent(
            query
          )}`,
          {
            credentials: "include",
          }
        );
        if (res.ok) {
          const data = await res.json();
          setGameResults(data);
        }
      } catch {
        // Ignore search errors
      } finally {
        setSearchingGames(false);
      }
    },
    [apiBaseUrl]
  );

  // Debounce game search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (gameQuery) {
        searchGames(gameQuery);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [gameQuery, searchGames]);

  // Handle tag input
  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      if (tags.length >= 10) {
        toast.error(t("tagsHint"));
        return;
      }
      if (!tags.includes(tagInput.trim())) {
        setTags([...tags, tagInput.trim()]);
      }
      setTagInput("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  // Save settings
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/streamer/settings`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          gameId: selectedGame?.id,
          tags,
        }),
      });

      if (!res.ok) throw new Error("Failed to save");

      toast.success(t("saveSuccess"));
      onClose();
    } catch {
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden shadow-2xl border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">{t("title")}</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-red-400">
              <AlertCircle className="w-12 h-12 mb-4" />
              <p>{error}</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Stream Title */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t("streamTitle")}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={140}
                  placeholder={t("streamTitlePlaceholder")}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg 
                             text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 
                             focus:ring-purple-500 transition-colors"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {title.length}/140 {t("streamTitleHint")}
                </p>
              </div>

              {/* Game Category */}
              <div className="relative">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t("gameCategory")}
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                  <input
                    type="text"
                    value={selectedGame ? selectedGame.name : gameQuery}
                    onChange={(e) => {
                      setGameQuery(e.target.value);
                      if (selectedGame) setSelectedGame(null);
                    }}
                    placeholder={t("gameCategoryPlaceholder")}
                    className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-600 rounded-lg 
                               text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 
                               focus:ring-purple-500 transition-colors"
                  />
                  {searchingGames && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-purple-400 animate-spin" />
                  )}
                </div>

                {/* Game search results */}
                {gameResults.length > 0 && !selectedGame && (
                  <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {gameResults.map((game) => (
                      <button
                        key={game.id}
                        onClick={() => {
                          setSelectedGame(game);
                          setGameQuery("");
                          setGameResults([]);
                        }}
                        className="w-full flex items-center gap-3 p-3 hover:bg-gray-700 transition-colors text-left"
                      >
                        {game.boxArtUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={game.boxArtUrl}
                            alt={game.name}
                            className="w-8 h-10 rounded"
                          />
                        )}
                        <span className="text-white">{game.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t("tags")}
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-purple-500/20 
                                 text-purple-300 rounded-full text-sm border border-purple-500/30"
                    >
                      <Tag className="w-3 h-3" />
                      {tag}
                      <button
                        onClick={() => removeTag(tag)}
                        className="ml-1 hover:text-red-400 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder={t("tagsPlaceholder")}
                  disabled={tags.length >= 10}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg 
                             text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 
                             focus:ring-purple-500 transition-colors disabled:opacity-50"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {tags.length}/10 {t("tagsHint")}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-700 bg-gray-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
          >
            {t("cancel", { ns: "common" })}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-2 px-6 py-2 bg-purple-600 hover:bg-purple-500 
                       text-white rounded-lg font-medium transition-colors disabled:opacity-50 
                       disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("saving")}
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {t("save", { ns: "common" })}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
