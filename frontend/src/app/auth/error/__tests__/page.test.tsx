import { render, screen } from "@testing-library/react";

const mockGet = jest.fn();

jest.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: mockGet,
  }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import AuthErrorPage from "../page";

describe("AuthErrorPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockReturnValue(null);
  });

  it("renders the matching error message for known reasons", () => {
    mockGet.mockReturnValue("authorization_failed");

    render(<AuthErrorPage />);

    expect(screen.getByRole("heading", { name: "授權失敗" })).toBeInTheDocument();
    expect(
      screen.getByText("無法完成 Twitch 授權，請確認您已允許所需的權限。")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回首頁" })).toHaveAttribute("href", "/");
  });

  it("falls back to the unknown error copy and renders the relogin action", () => {
    mockGet.mockReturnValue("something_else");

    render(<AuthErrorPage />);

    expect(screen.getByRole("heading", { name: "未知錯誤" })).toBeInTheDocument();
    expect(screen.getByText("發生了未知的認證錯誤，請重新嘗試。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新登入" })).toBeInTheDocument();
  });
});
