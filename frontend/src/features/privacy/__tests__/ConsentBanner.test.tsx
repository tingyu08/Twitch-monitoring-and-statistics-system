import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ConsentBannerWrapper } from "../components/ConsentBanner";
import { httpClient } from "@/lib/api/httpClient";
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
      expect(httpClient).toHaveBeenCalledWith(
        "/api/viewer/privacy/consent/accept-all",
        {
          method: "POST",
        }
      );
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
});
