import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickActionsPanel } from "../QuickActionsPanel";

let mockParams: { locale?: string } | undefined = { locale: "en" };

jest.mock("next/navigation", () => ({
  useParams: () => mockParams,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("QuickActionsPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { locale: "en" };
  });

  it("renders locale-aware action links", () => {
    render(<QuickActionsPanel />);

    expect(screen.getByText("quickActions")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /videosLibrary/i })).toHaveAttribute(
      "href",
      "/en/dashboard/streamer/videos"
    );
    expect(screen.getByRole("link", { name: /viewRevenue/i })).toHaveAttribute(
      "href",
      "/en/dashboard/streamer/revenue"
    );
  });

  it("calls onManageSettings and falls back to zh-TW locale", async () => {
    const user = userEvent.setup();
    const onManageSettings = jest.fn();
    mockParams = undefined;

    render(<QuickActionsPanel onManageSettings={onManageSettings} />);

    await user.click(screen.getByRole("button", { name: /manageSettings/i }));

    expect(onManageSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: /videosLibrary/i })).toHaveAttribute(
      "href",
      "/zh-TW/dashboard/streamer/videos"
    );
  });
});
