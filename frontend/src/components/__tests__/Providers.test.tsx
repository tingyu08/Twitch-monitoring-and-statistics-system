import { render, screen } from "@testing-library/react";
import { Providers } from "../Providers";

const mockQueryClientProvider = jest.fn(
  ({ children }: { children: React.ReactNode }) => <div data-testid="query-provider">{children}</div>
);
const mockThemeProvider = jest.fn(
  ({ children }: { children: React.ReactNode }) => <div data-testid="theme-provider">{children}</div>
);
const mockAuthProvider = jest.fn(
  ({ children }: { children: React.ReactNode }) => <div data-testid="auth-provider">{children}</div>
);

jest.mock("@tanstack/react-query", () => ({
  QueryClientProvider: (props: { client: unknown; children: React.ReactNode }) =>
    mockQueryClientProvider(props),
}));

jest.mock("@/lib/queryClient", () => ({
  queryClient: { id: "query-client" },
}));

jest.mock("@/features/theme", () => ({
  ThemeProvider: (props: { children: React.ReactNode }) => mockThemeProvider(props),
}));

jest.mock("@/features/auth/AuthContext", () => ({
  AuthProvider: (props: { children: React.ReactNode }) => mockAuthProvider(props),
}));

describe("Providers", () => {
  it("wraps children with query, theme, and auth providers", () => {
    render(
      <Providers>
        <span>child content</span>
      </Providers>
    );

    expect(screen.getByTestId("query-provider")).toBeInTheDocument();
    expect(screen.getByTestId("theme-provider")).toBeInTheDocument();
    expect(screen.getByTestId("auth-provider")).toBeInTheDocument();
    expect(screen.getByText("child content")).toBeInTheDocument();
    expect(mockQueryClientProvider).toHaveBeenCalledWith(
      expect.objectContaining({ client: expect.objectContaining({ id: "query-client" }) })
    );
  });
});
