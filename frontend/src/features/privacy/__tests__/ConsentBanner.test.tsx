import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  buildConsentBannerHandlers,
  ConsentBanner,
  ConsentBannerWrapper,
  hasStatus401,
  isHttpClient401Instance,
  isUnauthorizedConsentError,
} from "../components/ConsentBanner";
import { httpClient, HttpClientError } from "@/lib/api/httpClient";
import { useRouter } from "next/navigation";

// Mock httpClient
jest.mock("@/lib/api/httpClient");

// Mock useRouter
jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

describe("ConsentBanner", () => {
  const mockPush = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
  });

  it("should not render if user has already consented", async () => {
    (httpClient as jest.Mock).mockResolvedValueOnce({ hasConsent: true });

    const { container } = render(<ConsentBannerWrapper />);

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("should render if user has NOT consented", async () => {
    (httpClient as jest.Mock).mockResolvedValueOnce({ hasConsent: false });

    render(<ConsentBannerWrapper />);

    await waitFor(() => {
      expect(screen.getByText(/我們重視您的隱私/i)).toBeInTheDocument();
    });
  });

  it("should handle accept all", async () => {
    (httpClient as jest.Mock)
      .mockResolvedValueOnce({ hasConsent: false }) // Check status
      .mockResolvedValueOnce({}); // Accept all call

    render(<ConsentBannerWrapper />);

    await waitFor(() => {
      expect(screen.getByText(/接受全部/i)).toBeInTheDocument();
    });

    const acceptBtn = screen.getByText(/接受全部/i);
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(httpClient).toHaveBeenCalledWith("/api/viewer/pref/opt-all", {
        method: "POST",
      });
    });
  });

  it("should navigate to settings when configuring", async () => {
    (httpClient as jest.Mock).mockResolvedValueOnce({ hasConsent: false });

    render(<ConsentBannerWrapper />);

    await waitFor(() => {
      expect(screen.getByText(/自訂設定/i)).toBeInTheDocument();
    });

    const customizeBtn = screen.getByText(/自訂設定/i);
    fireEvent.click(customizeBtn);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        "/dashboard/viewer/settings?mode=privacy"
      );
    });
  });

  it("should not render banner when consent_banner_shown is in localStorage", async () => {
    localStorage.setItem("consent_banner_shown", "true");

    const { container } = render(<ConsentBannerWrapper />);

    // Should not call API since localStorage flag is set
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });

    expect(httpClient).not.toHaveBeenCalled();
  });

  it("should silently skip banner when API returns 401 HttpClientError", async () => {
    const error401 = { status: 401 } as unknown as HttpClientError;
    (httpClient as jest.Mock).mockRejectedValueOnce(error401);

    const { container } = render(<ConsentBannerWrapper />);

    await waitFor(() => {
      // No banner shown - 401 means unauthenticated
      expect(container.firstChild).toBeNull();
    });
  });

  it("should handle non-401 errors from API gracefully (no crash)", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    (httpClient as jest.Mock).mockRejectedValueOnce(new Error("Server error"));

    const { container } = render(<ConsentBannerWrapper />);

    await waitFor(() => {
      // Error is logged but banner is not shown
      expect(container.firstChild).toBeNull();
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("should handle accept all error gracefully", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    (httpClient as jest.Mock)
      .mockResolvedValueOnce({ hasConsent: false }) // Check status
      .mockRejectedValueOnce(new Error("Accept failed")); // Accept all fails

    render(<ConsentBannerWrapper />);

    await waitFor(() => {
      expect(screen.getByText(/接受全部/i)).toBeInTheDocument();
    });

    const acceptBtn = screen.getByText(/接受全部/i);
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith("接受同意失敗:", expect.any(Error));
    });

    consoleErrorSpy.mockRestore();
  });

  it("ConsentBanner standalone should render with onAcceptAll and onCustomize props", () => {
    const onAcceptAll = jest.fn();
    const onCustomize = jest.fn();

    render(<ConsentBanner onAcceptAll={onAcceptAll} onCustomize={onCustomize} />);

    expect(screen.getByText(/我們重視您的隱私/i)).toBeInTheDocument();
    expect(screen.getByText(/接受全部/i)).toBeInTheDocument();
    expect(screen.getByText(/自訂設定/i)).toBeInTheDocument();
  });

  it("ConsentBanner onAcceptAll is called when button is clicked", () => {
    const onAcceptAll = jest.fn();
    const onCustomize = jest.fn();

    render(<ConsentBanner onAcceptAll={onAcceptAll} onCustomize={onCustomize} />);

    fireEvent.click(screen.getByText(/接受全部/i));
    expect(onAcceptAll).toHaveBeenCalledTimes(1);
  });

  it("ConsentBanner onCustomize is called when button is clicked", () => {
    const onAcceptAll = jest.fn();
    const onCustomize = jest.fn();

    render(<ConsentBanner onAcceptAll={onAcceptAll} onCustomize={onCustomize} />);

    fireEvent.click(screen.getByText(/自訂設定/i));
    expect(onCustomize).toHaveBeenCalledTimes(1);
  });

  it("isUnauthorizedConsentError only matches 401 HttpClientError", () => {
    const mockedHttp401 = Object.assign(Object.create(HttpClientError.prototype), { status: 401 });
    expect(isHttpClient401Instance(mockedHttp401)).toBe(true);
    expect(isHttpClient401Instance(new Error("oops"))).toBe(false);
    expect(hasStatus401({ status: 401 })).toBe(true);
    expect(hasStatus401({ status: 403 })).toBe(false);
    expect(isUnauthorizedConsentError({ status: 401 })).toBe(true);
    expect(isUnauthorizedConsentError({ status: 403 })).toBe(false);
    expect(isUnauthorizedConsentError(new Error("oops"))).toBe(false);
  });

  it("buildConsentBannerHandlers customizes and routes correctly", () => {
    const push = jest.fn();
    const setShowBanner = jest.fn();

    buildConsentBannerHandlers({ router: { push }, setShowBanner }).handleCustomize();

    expect(localStorage.getItem("consent_banner_shown")).toBe("true");
    expect(setShowBanner).toHaveBeenCalledWith(false);
    expect(push).toHaveBeenCalledWith("/dashboard/viewer/settings?mode=privacy");
  });
});
