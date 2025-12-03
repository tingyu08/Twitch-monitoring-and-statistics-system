import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import LandingPage from "../page";

// Mock AuthContext，讓我們可以控制 user / loading 狀態
jest.mock("@/features/auth/AuthContext", () => ({
  useAuthSession: () => ({
    user: null,
    loading: false,
    error: null,
    logout: jest.fn(),
    refresh: jest.fn(),
  }),
}));

// Mock next/navigation，避免實際導航
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
  useSearchParams: () => ({
    get: () => null,
  }),
}));

describe("LandingPage 登入按鈕", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    delete window.location;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    window.location = { href: "" };
  });

  afterEach(() => {
    window.location = originalLocation;
  });

  it("顯示『使用 Twitch 登入』按鈕並在點擊時導向後端 OAuth 登入 URL", () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:4000";

    render(<LandingPage />);

    const button = screen.getByRole("button", { name: "使用 Twitch 登入" });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);

    expect(window.location.href).toBe(
      "http://localhost:4000/auth/twitch/login"
    );
  });
});


