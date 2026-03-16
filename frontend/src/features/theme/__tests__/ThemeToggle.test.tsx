import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle, ThemeToggleSimple } from "../ThemeToggle";

const mockUseTheme = jest.fn();

jest.mock("../ThemeProvider", () => ({
  useTheme: () => mockUseTheme(),
}));

describe("ThemeToggle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders all theme options and triggers theme changes", async () => {
    const user = userEvent.setup();
    const setTheme = jest.fn();
    mockUseTheme.mockReturnValue({
      theme: "light",
      resolvedTheme: "light",
      setTheme,
    });

    render(<ThemeToggle showLabel size="lg" />);

    expect(screen.getByRole("button", { name: "切換至淺色模式" }).className).toContain("bg-white");
    expect(screen.getByText("淺色")).toBeInTheDocument();
    expect(screen.getByText("深色")).toBeInTheDocument();
    expect(screen.getByText("系統")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "切換至深色模式" }));
    await user.click(screen.getByRole("button", { name: "切換至系統模式" }));

    expect(setTheme).toHaveBeenNthCalledWith(1, "dark");
    expect(setTheme).toHaveBeenNthCalledWith(2, "system");
  });

  it("toggles from dark to light in the simple variant", async () => {
    const user = userEvent.setup();
    const setTheme = jest.fn();
    mockUseTheme.mockReturnValue({
      resolvedTheme: "dark",
      setTheme,
    });

    render(<ThemeToggleSimple size="sm" />);

    await user.click(screen.getByRole("button", { name: "切換至淺色模式" }));

    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("toggles from light to dark in the simple variant", async () => {
    const user = userEvent.setup();
    const setTheme = jest.fn();
    mockUseTheme.mockReturnValue({
      resolvedTheme: "light",
      setTheme,
    });

    render(<ThemeToggleSimple />);

    await user.click(screen.getByRole("button", { name: "切換至深色模式" }));

    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("uses default props when no explicit options are provided", () => {
    const setTheme = jest.fn();
    mockUseTheme.mockReturnValue({
      theme: "system",
      resolvedTheme: "light",
      setTheme,
    });

    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "切換至系統模式" })).toBeInTheDocument();
  });
});
