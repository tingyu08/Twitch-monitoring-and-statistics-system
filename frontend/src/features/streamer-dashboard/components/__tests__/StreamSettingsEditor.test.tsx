import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StreamSettingsEditor } from "../StreamSettingsEditor";

const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
const mockGetApiUrl = jest.fn((path: string) => `http://api.test${path}`);
const mockTranslate = jest.fn((key: string) => key);

jest.mock("next-intl", () => ({
  useTranslations: () => mockTranslate,
}));

jest.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt || ""} />,
}));

jest.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

jest.mock("@/lib/api/getApiUrl", () => ({
  getApiUrl: (path: string) => mockGetApiUrl(path),
}));

describe("StreamSettingsEditor", () => {
  const mockOnClose = jest.fn();
  const originalConfirm = window.confirm;

  beforeEach(() => {
    jest.clearAllMocks();
    window.confirm = jest.fn(() => true);

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/streamer/settings") && !init?.method) {
        return createJsonResponse({
          title: "Current title",
          gameId: "game-1",
          gameName: "Old Game",
          tags: ["alpha"],
          language: "zh-tw",
        });
      }

      if (url.endsWith("/api/streamer/templates") && !init?.method) {
        return createJsonResponse([
          {
            id: "tpl-1",
            templateName: "Starter",
            title: "Template title",
            gameId: "game-2",
            gameName: "Template Game",
            tags: ["focus", "chatting"],
            language: "zh-tw",
          },
        ]);
      }

      if (url.includes("/api/streamer/games/search")) {
        return createJsonResponse([
          { id: "game-3", name: "Search Result", boxArtUrl: "https://example.com/game.jpg" },
        ]);
      }

      if (url.endsWith("/api/streamer/settings") && init?.method === "POST") {
        return createJsonResponse({ success: true });
      }

      if (url.endsWith("/api/streamer/templates") && init?.method === "POST") {
        return createJsonResponse({ success: true });
      }

      if (url.includes("/api/streamer/templates/") && init?.method === "DELETE") {
        return createJsonResponse({ success: true });
      }

      return createJsonResponse({});
    }) as jest.Mock;
  });

  afterAll(() => {
    window.confirm = originalConfirm;
  });

  it("returns null when closed", () => {
    const { container } = render(<StreamSettingsEditor isOpen={false} onClose={mockOnClose} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("loads settings and templates on open", async () => {
    render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);

    expect(await screen.findByDisplayValue("Current title")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Old Game")).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Starter" })).toBeInTheDocument();
  });

  it("shows a fetch error when settings request fails", async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: "Broken",
        json: async () => ({ error: "Backend exploded" }),
      })
    );

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);

    expect(await screen.findByText("loadError (Error 500: Broken)")).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("renders json-backed fetch errors and loading states", async () => {
    let resolveSettings: ((value: unknown) => void) | undefined;
    (global.fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSettings = resolve;
        })
    );

    const { container } = render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();

    resolveSettings?.({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error: "Detailed failure" }),
    });

    expect(await screen.findByText("loadError (Error 400: Bad Request)")).toBeInTheDocument();
  });

  it("covers fallback state initialization and unknown load errors", async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce({})
      .mockResolvedValueOnce(
        createJsonResponse({
          title: "",
          gameId: "",
          gameName: "",
          language: "zh-tw",
        })
      )
      .mockResolvedValueOnce(createJsonResponse([]));

    const { rerender } = render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);
    expect(await screen.findByText("loadError (Unknown error)")).toBeInTheDocument();

    rerender(<StreamSettingsEditor isOpen={false} onClose={mockOnClose} />);
    rerender(<StreamSettingsEditor isOpen onClose={mockOnClose} />);

    expect(await screen.findByPlaceholderText("streamTitlePlaceholder")).toHaveValue("");
    expect(screen.getByPlaceholderText("gameCategoryPlaceholder")).toHaveValue("");
    expect(screen.getByText("0/10 tagsHint")).toBeInTheDocument();
  });

  it("searches, edits tags, creates a template, and saves settings", async () => {
    const user = userEvent.setup({ delay: null });
    render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);

    await screen.findByDisplayValue("Current title");

    const gameInput = screen.getByPlaceholderText("gameCategoryPlaceholder");
    await user.clear(gameInput);
    await user.type(gameInput, "se");

    expect(await screen.findByRole("button", { name: /Search Result/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Search Result/i }));
    expect(screen.getByDisplayValue("Search Result")).toBeInTheDocument();

    const tagInput = screen.getByPlaceholderText("tagsPlaceholder");
    await user.type(tagInput, "beta{enter}");
    expect(screen.getByText("beta")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button").find((button) => button.className.includes("hover:text-red-400"))!);
    expect(screen.queryByText("alpha")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "saveAsTemplate" }));
    await user.type(screen.getByPlaceholderText("templateNamePlaceholder"), "New Template");
    await user.click(screen.getAllByRole("button", { name: "save" })[1]);

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("templateCreateSuccess");
    });

    await user.clear(screen.getByPlaceholderText("streamTitlePlaceholder"));
    await user.type(screen.getByPlaceholderText("streamTitlePlaceholder"), "Updated title");
    await user.click(screen.getAllByRole("button", { name: "save" })[0]);

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("saveSuccess");
      expect(mockOnClose).toHaveBeenCalled();
    });
  }, 15000);

  it("loads and deletes templates and handles save failures", async () => {
    const user = userEvent.setup();
    render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);

    await screen.findByDisplayValue("Current title");
    await user.selectOptions(screen.getByRole("combobox"), "tpl-1");
    await waitFor(() => {
      expect(screen.getByDisplayValue("Template title")).toBeInTheDocument();
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("templateLoaded");

    await user.click(screen.getByTitle("manageTemplates"));
    await user.click(screen.getByTitle("deleteTemplate"));
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("templateDeleteSuccess");
    });

    (global.fetch as jest.Mock).mockImplementationOnce((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/streamer/settings") && init?.method === "POST") {
        return Promise.resolve({ ok: false });
      }
      return Promise.resolve(createJsonResponse({}));
    });

    await user.click(screen.getAllByRole("button", { name: "save" })[0]);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("saveError");
    });
  });

  it("does not search for short queries and supports dialog close actions", async () => {
    const user = userEvent.setup();
    render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);

    await screen.findByDisplayValue("Current title");
    const baselineCalls = (global.fetch as jest.Mock).mock.calls.length;

    await user.clear(screen.getByPlaceholderText("gameCategoryPlaceholder"));
    await user.type(screen.getByPlaceholderText("gameCategoryPlaceholder"), "a");

    await new Promise((resolve) => setTimeout(resolve, 350));

    await waitFor(() => {
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(baselineCalls);
    });

    await user.click(screen.getByRole("button", { name: "saveAsTemplate" }));
    expect(screen.getByPlaceholderText("templateNamePlaceholder")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "cancel" })[1]);
    expect(screen.queryByPlaceholderText("templateNamePlaceholder")).not.toBeInTheDocument();

    await user.click(screen.getByTitle("manageTemplates"));
    await user.click(screen.getByRole("button", { name: "deleteTemplate" }));
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("templateDeleteSuccess");
    });
  });

  it("shows tag limit error and loads template without a game", async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/streamer/settings") && !init?.method) {
        return Promise.resolve(
          createJsonResponse({
            title: "Current title",
            gameId: "game-1",
            gameName: "Old Game",
            tags: ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"],
            language: "zh-tw",
          })
        );
      }
      if (url.endsWith("/api/streamer/templates") && !init?.method) {
        return Promise.resolve(
          createJsonResponse([
            {
              id: "tpl-null",
              templateName: "No Game",
              title: "No Game Title",
              gameId: "",
              gameName: "",
              tags: ["solo"],
              language: "zh-tw",
            },
          ])
        );
      }
      return Promise.resolve(createJsonResponse({}));
    });

    render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);
    await screen.findByDisplayValue("Current title");

    const tagInput = screen.getByPlaceholderText("tagsPlaceholder");
    fireEvent.change(tagInput, { target: { value: "overflow" } });
    fireEvent.keyDown(tagInput, { key: "Enter", code: "Enter", charCode: 13, preventDefault: jest.fn() });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("tagsHint");
    });

    await user.click(screen.getByTitle("manageTemplates"));
    await user.click(screen.getByTitle("loadTemplate"));
    await waitFor(() => {
      expect(screen.getByDisplayValue("No Game Title")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("gameCategoryPlaceholder")).toHaveValue("");
    });
    expect(screen.getByText("solo")).toBeInTheDocument();

    await user.click(screen.getByTitle("manageTemplates"));
    const closeDialogButton = screen
      .getAllByRole("button")
      .find((button) => button.className === "text-gray-400 hover:text-white");
    expect(closeDialogButton).toBeTruthy();
    await user.click(closeDialogButton!);
    expect(screen.queryByText("manageTemplates")).not.toBeInTheDocument();
  });

  it("covers search, save-template, and manage-template loading states", async () => {
    const user = userEvent.setup();
    let resolveSearch: ((value: unknown) => void) | undefined;
    let resolveCreate: ((value: unknown) => void) | undefined;
    let resolveTemplates: ((value: unknown) => void) | undefined;

    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/streamer/settings") && !init?.method) {
        return Promise.resolve(
          createJsonResponse({
            title: "Current title",
            gameId: "game-1",
            gameName: "Old Game",
            tags: [],
            language: "zh-tw",
          })
        );
      }
      if (url.endsWith("/api/streamer/templates") && !init?.method) {
        return new Promise((resolve) => {
          resolveTemplates = resolve;
        });
      }
      if (url.includes("/api/streamer/games/search")) {
        return new Promise((resolve) => {
          resolveSearch = resolve;
        });
      }
      if (url.endsWith("/api/streamer/templates") && init?.method === "POST") {
        return new Promise((resolve) => {
          resolveCreate = resolve;
        });
      }
      return Promise.resolve(createJsonResponse({}));
    });

    const { container } = render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);
    await screen.findByDisplayValue("Current title");

    await user.clear(screen.getByPlaceholderText("gameCategoryPlaceholder"));
    await user.type(screen.getByPlaceholderText("gameCategoryPlaceholder"), "ab");
    await waitFor(() => expect(resolveSearch).toBeDefined());
    expect(container.querySelectorAll(".animate-spin").length).toBeGreaterThan(0);

    resolveSearch?.(createJsonResponse([{ id: "game-4", name: "Pending Search", boxArtUrl: "" }]));
    expect(await screen.findByRole("button", { name: /Pending Search/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "saveAsTemplate" }));
    const saveButtons = screen.getAllByRole("button", { name: "save" });
    expect(saveButtons[1]).toBeDisabled();
    await user.type(screen.getByPlaceholderText("templateNamePlaceholder"), "Pending template");
    await user.click(saveButtons[1]);
    await waitFor(() => expect(resolveCreate).toBeDefined());
    expect(screen.getAllByRole("button", { name: "save" })[1]).toBeDisabled();
    resolveCreate?.(createJsonResponse({ success: true }));
    resolveTemplates?.(createJsonResponse([]));
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("templateCreateSuccess");
    });

    await user.click(screen.getByTitle("manageTemplates"));
    expect(screen.getByText("noTemplates")).toBeInTheDocument();
  });

  it("covers template fetch failure and game search failure branches", async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/streamer/settings") && !init?.method) {
        return Promise.resolve(
          createJsonResponse({
            title: "Current title",
            gameId: "game-1",
            gameName: "Old Game",
            tags: [],
            language: "zh-tw",
          })
        );
      }
      if (url.endsWith("/api/streamer/templates") && !init?.method) {
        return Promise.reject(new Error("templates down"));
      }
      if (url.includes("/api/streamer/games/search")) {
        return Promise.reject(new Error("search down"));
      }
      return Promise.resolve(createJsonResponse({}));
    });

    render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);
    await screen.findByDisplayValue("Current title");
    await user.clear(screen.getByPlaceholderText("gameCategoryPlaceholder"));
    await user.type(screen.getByPlaceholderText("gameCategoryPlaceholder"), "xy");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Pending Search/i })).not.toBeInTheDocument();
    });
  });

  it("covers false ok fetches, duplicate tags, confirm cancellation, and unknown select option", async () => {
    const user = userEvent.setup();
    let resolveTemplates: ((value: unknown) => void) | undefined;
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/streamer/settings") && !init?.method) {
        return Promise.resolve(
          createJsonResponse({
            title: "Current title",
            gameId: "game-1",
            gameName: "Old Game",
            tags: ["alpha"],
            language: "zh-tw",
          })
        );
      }
      if (url.endsWith("/api/streamer/templates") && !init?.method) {
        return new Promise((resolve) => {
          resolveTemplates = resolve;
        });
      }
      if (url.includes("/api/streamer/games/search")) {
        return Promise.resolve({ ok: false, json: async () => [] });
      }
      return Promise.resolve(createJsonResponse({}));
    });
    window.confirm = jest.fn(() => false);

    render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);
    await screen.findByDisplayValue("Current title");

    const tagInput = screen.getByPlaceholderText("tagsPlaceholder");
    fireEvent.change(tagInput, { target: { value: "alpha" } });
    fireEvent.keyDown(tagInput, { key: "Enter", code: "Enter", charCode: 13, preventDefault: jest.fn() });
    expect(screen.getAllByText("alpha")).toHaveLength(1);

    await user.clear(screen.getByPlaceholderText("gameCategoryPlaceholder"));
    await user.type(screen.getByPlaceholderText("gameCategoryPlaceholder"), "zz");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /zz/i })).not.toBeInTheDocument();
    });

    await user.click(screen.getByTitle("manageTemplates"));
    expect(screen.queryByText("noTemplates")).not.toBeInTheDocument();
    expect(screen.queryByText("manageTemplates")).toBeInTheDocument();

    resolveTemplates?.(
      createJsonResponse([
        {
          id: "tpl-untagged",
          templateName: "Untyped",
          title: "No Tags",
          gameId: "game-1",
          gameName: "Old Game",
          language: "zh-tw",
        },
      ])
    );

    expect(await screen.findByTitle("deleteTemplate")).toBeInTheDocument();
    await user.click(screen.getByTitle("deleteTemplate"));
    expect(mockToastSuccess).not.toHaveBeenCalledWith("templateDeleteSuccess");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "missing-template" } });
    expect(screen.getByDisplayValue("Current title")).toBeInTheDocument();
  });

  it("covers non-ok settings and template fetch branches", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({}),
      })
      .mockResolvedValueOnce({ ok: false, json: async () => [] });

    render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);
    expect(await screen.findByText("loadError (Error 401: Unauthorized)")).toBeInTheDocument();
  });

  it("covers non-ok game search responses", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/streamer/settings") && !init?.method) {
        return Promise.resolve(
          createJsonResponse({ title: "Current title", gameId: "", gameName: "", tags: [], language: "zh-tw" })
        );
      }
      if (url.endsWith("/api/streamer/templates") && !init?.method) {
        return Promise.resolve(createJsonResponse([]));
      }
      if (url.includes("/api/streamer/games/search")) {
        return Promise.resolve({ ok: false, json: async () => [] });
      }
      return Promise.resolve(createJsonResponse({}));
    });

    render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);
    await screen.findByDisplayValue("Current title");
    await user.clear(screen.getByPlaceholderText("gameCategoryPlaceholder"));
    await user.type(screen.getByPlaceholderText("gameCategoryPlaceholder"), "qq");
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "http://api.test/api/streamer/games/search?q=qq",
        expect.objectContaining({ credentials: "include" })
      );
      expect(screen.queryByRole("button", { name: /qq/i })).not.toBeInTheDocument();
    });

    jest.useRealTimers();
  });

  it("falls back to an empty tag list when a template has no tags", async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/streamer/settings") && !init?.method) {
        return Promise.resolve(
          createJsonResponse({ title: "Current title", gameId: "", gameName: "", tags: ["alpha"], language: "zh-tw" })
        );
      }
      if (url.endsWith("/api/streamer/templates") && !init?.method) {
        return Promise.resolve(
          createJsonResponse([
            {
              id: "tpl-no-tags",
              templateName: "No Tags",
              title: "Fallback Tags Title",
              gameId: "",
              gameName: "",
              language: "zh-tw",
            },
          ])
        );
      }
      return Promise.resolve(createJsonResponse({}));
    });

    render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);
    await screen.findByDisplayValue("Current title");
    await user.selectOptions(screen.getByRole("combobox"), "tpl-no-tags");

    await waitFor(() => {
      expect(screen.getByDisplayValue("Fallback Tags Title")).toBeInTheDocument();
      expect(screen.getByText("0/10 tagsHint")).toBeInTheDocument();
    });
  });

  it("shows template create and delete errors", async () => {
    const user = userEvent.setup();
    render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);

    await screen.findByDisplayValue("Current title");

    (global.fetch as jest.Mock).mockImplementationOnce(() => Promise.resolve({ ok: false }));
    await user.click(screen.getByRole("button", { name: "saveAsTemplate" }));
    await user.type(screen.getByPlaceholderText("templateNamePlaceholder"), "Broken Template");
    await user.click(screen.getAllByRole("button", { name: "save" })[1]);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("templateCreateError");
    });

    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/streamer/settings") && !init?.method) {
        return Promise.resolve(createJsonResponse({ title: "Current title", gameId: "game-1", gameName: "Old Game", tags: ["alpha"], language: "zh-tw" }));
      }
      if (url.endsWith("/api/streamer/templates") && !init?.method) {
        return Promise.resolve(createJsonResponse([{ id: "tpl-1", templateName: "Starter", title: "Template title", gameId: "", gameName: "", tags: [], language: "zh-tw" }]));
      }
      if (url.includes("/api/streamer/templates/") && init?.method === "DELETE") {
        return Promise.resolve({ ok: false });
      }
      return Promise.resolve(createJsonResponse({}));
    });

    render(<StreamSettingsEditor isOpen onClose={mockOnClose} />);
    await screen.findAllByDisplayValue("Current title");
    await user.click(screen.getAllByTitle("manageTemplates")[1]);
    await user.click(screen.getByTitle("deleteTemplate"));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("templateDeleteError");
    });
  });
});

function createJsonResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  };
}
