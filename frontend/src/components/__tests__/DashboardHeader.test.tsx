import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardHeader } from "../DashboardHeader";

const mockPush = jest.fn();
const mockPrefetch = jest.fn();
const mockLogout = jest.fn();
const mockUseAuthSession = jest.fn();
const mockUseLocale = jest.fn(() => "en");
const mockUsePathname = jest.fn(() => "/en/dashboard/viewer");

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, prefetch: mockPrefetch }),
  usePathname: () => mockUsePathname(),
}));

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => mockUseLocale(),
}));

jest.mock("@/features/auth/AuthContext", () => ({
  useAuthSession: () => mockUseAuthSession(),
}));

jest.mock("@/features/theme", () => ({
  ThemeToggle: function ThemeToggle() { return <div>ThemeToggle</div>; },
  ThemeToggleSimple: function ThemeToggleSimple() { return <div>ThemeToggleSimple</div>; },
}));

jest.mock("@/components/LocaleSwitcher", () => function LocaleSwitcher() { return <div>LocaleSwitcher</div>; });

describe("DashboardHeader", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuthSession.mockReturnValue({
      user: { displayName: "Demo User" },
      logout: mockLogout,
    });
    mockUseLocale.mockReturnValue("en");
    mockUsePathname.mockReturnValue("/en/dashboard/viewer");
  });

  it("renders desktop viewer state and only navigates to inactive role", async () => {
    const user = userEvent.setup();
    render(<DashboardHeader variant="viewer" />);

    expect(screen.getByText("VIEWER DASHBOARD")).toBeInTheDocument();
    expect(screen.getByText("LocaleSwitcher")).toBeInTheDocument();
    expect(screen.getByText("ThemeToggle")).toBeInTheDocument();

    await user.hover(screen.getByRole("button", { name: "viewer.roleViewer" }));
    await user.hover(screen.getByRole("button", { name: "viewer.roleStreamer" }));
    await user.click(screen.getByRole("button", { name: "viewer.roleViewer" }));
    await user.click(screen.getByRole("button", { name: "viewer.roleStreamer" }));

    expect(mockPrefetch).toHaveBeenNthCalledWith(1, "/en/dashboard/viewer");
    expect(mockPrefetch).toHaveBeenNthCalledWith(2, "/en/dashboard/streamer");
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/en/dashboard/streamer");
  });

  it("uses the default viewer variant when no prop is provided", () => {
    mockUsePathname.mockReturnValue("/en/dashboard/streamer");

    render(<DashboardHeader />);

    expect(screen.getByText("STREAMER DASHBOARD")).toBeInTheDocument();
  });

  it("allows desktop switch back to viewer from streamer", async () => {
    const user = userEvent.setup();
    mockUsePathname.mockReturnValue("/en/dashboard/streamer");

    render(<DashboardHeader variant="streamer" />);

    await user.click(screen.getByRole("button", { name: "viewer.roleViewer" }));

    expect(mockPush).toHaveBeenCalledWith("/en/dashboard/viewer");
  });

  it("derives streamer state from pathname and shows mobile navigation", async () => {
    const user = userEvent.setup();
    mockUsePathname.mockReturnValue("/en/dashboard/streamer");

    render(<DashboardHeader variant="streamer" />);

    expect(screen.getByText("STREAMER DASHBOARD")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "開啟選單" }));

    expect(screen.getByText("nav.switchRole")).toBeInTheDocument();
    expect(screen.getByText("nav.appearance")).toBeInTheDocument();
    expect(screen.queryByText("nav.settings")).not.toBeInTheDocument();
    expect(screen.getByText("common.logout")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "nav.viewerDashboard" }));
    expect(mockPush).toHaveBeenCalledWith("/en/dashboard/viewer");
  });

  it("shows viewer-only mobile settings and closes menu after logout", async () => {
    const user = userEvent.setup();
    mockLogout.mockResolvedValue(undefined);
    render(<DashboardHeader variant="viewer" />);

    await user.click(screen.getByRole("button", { name: "開啟選單" }));
    await user.click(screen.getByText("nav.settings"));
    expect(mockPush).toHaveBeenCalledWith("/en/dashboard/viewer/settings");

    await user.click(screen.getByRole("button", { name: "開啟選單" }));

    await user.click(screen.getAllByText("common.logout")[0]);

    expect(mockLogout).toHaveBeenCalled();
    expect(screen.queryByText("nav.switchRole")).not.toBeInTheDocument();
  });

  it("navigates to streamer dashboard from viewer mobile menu", async () => {
    const user = userEvent.setup();
    render(<DashboardHeader variant="viewer" />);

    await user.click(screen.getByRole("button", { name: "開啟選單" }));
    await user.hover(screen.getByRole("button", { name: "nav.streamerDashboard" }));
    await user.click(screen.getByRole("button", { name: "nav.streamerDashboard" }));

    expect(mockPrefetch).toHaveBeenCalledWith("/en/dashboard/streamer");
    expect(mockPush).toHaveBeenCalledWith("/en/dashboard/streamer");
    expect(screen.queryByText("nav.switchRole")).not.toBeInTheDocument();
  });
});
