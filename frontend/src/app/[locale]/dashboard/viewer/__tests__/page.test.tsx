import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ViewerDashboardPage from "../page";
import { viewerApi } from "@/lib/api/viewer";
import { useAuthSession } from "@/features/auth/AuthContext";

// Mock next/image to avoid issues with optimized images in test
jest.mock("next/image", () => ({
  __esModule: true,
  default: function MockImage(props: React.ImgHTMLAttributes<HTMLImageElement>) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" {...props} />;
  },
}));

// Mock next/navigation
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock AuthContext
jest.mock("@/features/auth/AuthContext", () => ({
  useAuthSession: jest.fn(),
}));

// Mock API
jest.mock("@/lib/api/viewer", () => ({
  viewerApi: {
    getFollowedChannels: jest.fn(),
  },
}));

// Mock isViewer from auth module
jest.mock("@/lib/api/auth", () => ({
  isViewer: () => true,
  isStreamer: () => false,
}));

// Helper to create a valid mock user
const createMockUser = () => ({
  viewerId: "v1",
  twitchUserId: "t1",
  displayName: "Tester",
  avatarUrl: "http://example.com/avatar.jpg",
  role: "viewer" as const,
  consentedAt: new Date().toISOString(),
});

describe("ViewerDashboardPage", () => {
  const renderWithQueryClient = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  };
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows loading spinner when user is not authenticated", () => {
    (useAuthSession as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
    });

    const { container } = renderWithQueryClient(<ViewerDashboardPage />);
    
    // When user is null, loadChannels is not called, so 'loading' state stays true
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it("displays empty message when no channels", async () => {
    // Setup API mock first
    (viewerApi.getFollowedChannels as jest.Mock).mockResolvedValue([]);
    
    (useAuthSession as jest.Mock).mockReturnValue({
      user: createMockUser(),
      loading: false,
    });

    renderWithQueryClient(<ViewerDashboardPage />);

    await waitFor(
      () => {
        expect(screen.getByText("viewer.noFollowedChannels")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });
});
