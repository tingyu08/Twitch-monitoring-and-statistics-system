import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";

import AuthErrorPage from "../page";
import { redirectToLogin } from "../navigation";

const mockGet = jest.fn();

jest.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: mockGet }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock("../navigation", () => ({
  redirectToLogin: jest.fn(),
}));

describe("AuthErrorPage", () => {
  beforeEach(() => {
    mockGet.mockReset();
    jest.mocked(redirectToLogin).mockClear();
  });

  it("renders unknown error fallback when reason is missing", async () => {
    mockGet.mockReturnValue(null);
    render(<AuthErrorPage />);

    expect(await screen.findByText("未知錯誤")).toBeInTheDocument();
    expect(screen.getByText("發生了未知的認證錯誤，請重新嘗試。")).toBeInTheDocument();
  });

  it("renders mapped authorization error", async () => {
    mockGet.mockReturnValue("authorization_failed");
    render(<AuthErrorPage />);

    expect(await screen.findByText("授權失敗")).toBeInTheDocument();
  });

  it("falls back to unknown error for unmapped reasons", async () => {
    mockGet.mockReturnValue("something-else");
    render(<AuthErrorPage />);

    expect(await screen.findByText("未知錯誤")).toBeInTheDocument();
  });

  it("redirects to login when retry button is clicked", async () => {
    render(<AuthErrorPage />);

    fireEvent.click(await screen.findByRole("button", { name: "重新登入" }));

    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });

  it("redirectToLogin redirects to login page", () => {
    redirectToLogin();

    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });
});
