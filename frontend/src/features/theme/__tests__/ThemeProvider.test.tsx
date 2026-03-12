import { render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "../ThemeProvider";

const mockNextThemesProvider = jest.fn(
  ({ children }: { children: React.ReactNode }) => <div data-testid="next-themes">{children}</div>
);
const mockUseNextTheme = jest.fn(() => ({ theme: "system" }));

jest.mock("next-themes", () => ({
  ThemeProvider: (props: React.ComponentProps<"div"> & { children: React.ReactNode }) =>
    mockNextThemesProvider(props),
  useTheme: () => mockUseNextTheme(),
}));

describe("ThemeProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes default theme props through to next-themes", () => {
    render(
      <ThemeProvider storageKey="bmad-theme">
        <span>inside provider</span>
      </ThemeProvider>
    );

    expect(screen.getByTestId("next-themes")).toBeInTheDocument();
    expect(screen.getByText("inside provider")).toBeInTheDocument();
    expect(mockNextThemesProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        attribute: "class",
        defaultTheme: "system",
        enableSystem: true,
        disableTransitionOnChange: true,
        storageKey: "bmad-theme",
      })
    );
  });

  it("re-exports useTheme from next-themes", () => {
    expect(useTheme()).toEqual({ theme: "system" });
    expect(mockUseNextTheme).toHaveBeenCalledTimes(1);
  });
});
