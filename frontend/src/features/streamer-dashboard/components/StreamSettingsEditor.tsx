"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  X,
  Save,
  Search,
  Tag,
  Loader2,
  AlertCircle,
  FolderOpen,
  Plus,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
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

interface Template {
  id: string;
  templateName: string;
  title: string;
  gameId: string;
  gameName: string;
  tags: string[];
  language: string;
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
  const tCommon = useTranslations("common");

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

  // Templates state
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false);
  const [showManageTemplatesDialog, setShowManageTemplatesDialog] =
    useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateActionLoading, setTemplateActionLoading] = useState(false);

  const apiBaseUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    (process.env.NODE_ENV === "production"
      ? "https://twitch-monitoring-and-statistics-system.onrender.com"
      : "http://localhost:4000");

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
        if (!res.ok) {
          try {
            const errJson = await res.json();
            throw new Error(
              errJson.error || `Error ${res.status}: ${res.statusText}`,
            );
          } catch {
            throw new Error(`Error ${res.status}: ${res.statusText}`);
          }
        }
        const data = await res.json();
        setSettings(data);
        setTitle(data.title || "");
        setSelectedGame(
          data.gameId
            ? { id: data.gameId, name: data.gameName, boxArtUrl: "" }
            : null,
        );
        setTags(data.tags || []);
      } catch (err: any) {
        console.error("Failed to load settings:", err);
        setError(`${t("loadError")} (${err.message || "Unknown error"})`);
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
            query,
          )}`,
          {
            credentials: "include",
          },
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
    [apiBaseUrl],
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

  // Fetch templates when dialog opens
  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const fetchTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/streamer/templates`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch {
      // Ignore errors for templates
    } finally {
      setLoadingTemplates(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!newTemplateName.trim()) return;

    setTemplateActionLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/streamer/templates`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: newTemplateName,
          title,
          gameId: selectedGame?.id,
          tags,
        }),
      });

      if (!res.ok) throw new Error("Failed to create template");

      toast.success(t("templateCreateSuccess"));
      setShowSaveTemplateDialog(false);
      setNewTemplateName("");
      fetchTemplates();
    } catch {
      toast.error(t("templateCreateError"));
    } finally {
      setTemplateActionLoading(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm(t("deleteTemplateConfirm"))) return;

    setTemplateActionLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/streamer/templates/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) throw new Error("Failed to delete");

      toast.success(t("templateDeleteSuccess"));
      setTemplates(templates.filter((tpl) => tpl.id !== id));
    } catch {
      toast.error(t("templateDeleteError"));
    } finally {
      setTemplateActionLoading(false);
    }
  };

  const loadTemplate = (template: Template) => {
    setTitle(template.title);
    if (template.gameId && template.gameName) {
      setSelectedGame({
        id: template.gameId,
        name: template.gameName,
        boxArtUrl: "", // 模板中可能沒有圖片 URL，這沒關係
      });
    } else {
      setSelectedGame(null);
    }
    setTags(template.tags || []);
    setShowManageTemplatesDialog(false);
    toast.success(t("templateLoaded"));
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
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-white">{t("title")}</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowManageTemplatesDialog(true)}
                className="p-1.5 text-gray-400 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors"
                title={t("manageTemplates")}
              >
                <FolderOpen className="w-4 h-4" />
              </button>
            </div>
          </div>
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
              {/* Template Loader */}
              {templates.length > 0 && (
                <div className="flex items-center gap-3 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                  <FolderOpen className="w-4 h-4 text-purple-400" />
                  <select
                    className="bg-transparent text-sm text-purple-200 focus:outline-none w-full cursor-pointer"
                    onChange={(e) => {
                      const template = templates.find(
                        (t) => t.id === e.target.value,
                      );
                      if (template) loadTemplate(template);
                      e.target.value = ""; // Reset selection
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled className="bg-gray-800">
                      {t("loadTemplate")}
                    </option>
                    {templates.map((tpl) => (
                      <option
                        key={tpl.id}
                        value={tpl.id}
                        className="bg-gray-800"
                      >
                        {tpl.templateName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

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
        <div className="flex items-center justify-between p-6 border-t border-gray-700 bg-gray-800/50">
          <button
            onClick={() => setShowSaveTemplateDialog(true)}
            className="text-sm text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            {t("saveAsTemplate")}
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
            >
              {tCommon("cancel")}
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
                  {tCommon("save")}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Save Template Dialog */}
      {showSaveTemplateDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 rounded-xl w-full max-w-sm p-6 shadow-2xl border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">
              {t("saveAsTemplate")}
            </h3>
            <input
              type="text"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              placeholder={t("templateNamePlaceholder")}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg 
                       text-white placeholder-gray-500 mb-4 focus:ring-1 focus:ring-purple-500"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSaveTemplateDialog(false)}
                className="px-3 py-1.5 text-gray-400 hover:text-white"
              >
                {tCommon("cancel")}
              </button>
              <button
                onClick={handleCreateTemplate}
                disabled={!newTemplateName.trim() || templateActionLoading}
                className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-500 disabled:opacity-50"
              >
                {tCommon("save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Templates Dialog */}
      {showManageTemplatesDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 rounded-xl w-full max-w-md p-6 shadow-2xl border border-gray-700 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">
                {t("manageTemplates")}
              </h3>
              <button
                onClick={() => setShowManageTemplatesDialog(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 min-h-[200px]">
              {loadingTemplates ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
                </div>
              ) : templates.length === 0 ? (
                <p className="text-center text-gray-500 py-8">
                  {t("noTemplates")}
                </p>
              ) : (
                templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="flex items-center justify-between p-3 bg-gray-800 rounded-lg group"
                  >
                    <div className="overflow-hidden">
                      <p className="font-medium text-white truncate">
                        {tpl.templateName}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {tpl.title}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => loadTemplate(tpl)}
                        className="p-1.5 text-gray-400 hover:text-purple-400"
                        title={t("loadTemplate")}
                      >
                        <FolderOpen className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(tpl.id)}
                        disabled={templateActionLoading}
                        className="p-1.5 text-gray-400 hover:text-red-400"
                        title={t("deleteTemplate")}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
