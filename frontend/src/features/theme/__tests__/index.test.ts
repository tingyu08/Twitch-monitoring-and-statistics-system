import { ThemeProvider, useTheme } from "../ThemeProvider";
import { ThemeToggle, ThemeToggleSimple } from "../ThemeToggle";
import {
  ThemeProvider as ThemeProviderFromIndex,
  ThemeToggle as ThemeToggleFromIndex,
  ThemeToggleSimple as ThemeToggleSimpleFromIndex,
  useTheme as useThemeFromIndex,
} from "../index";

describe("theme index barrel", () => {
  it("re-exports theme modules", () => {
    expect(ThemeProviderFromIndex).toBe(ThemeProvider);
    expect(useThemeFromIndex).toBe(useTheme);
    expect(ThemeToggleFromIndex).toBe(ThemeToggle);
    expect(ThemeToggleSimpleFromIndex).toBe(ThemeToggleSimple);
  });
});
