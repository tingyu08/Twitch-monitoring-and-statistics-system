import {
  getDashboardLayout,
  resetDashboardLayout,
  saveDashboardLayout,
  type DashboardLayout,
} from "../dashboard-layout";
import { httpClient } from "../httpClient";

jest.mock("../httpClient");

const mockHttpClient = httpClient as jest.MockedFunction<typeof httpClient>;

describe("dashboard-layout api", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("gets a saved dashboard layout", async () => {
    const layout: DashboardLayout = [{ i: "summary", x: 0, y: 0, w: 4, h: 2 }];
    mockHttpClient.mockResolvedValueOnce({ layout });

    const result = await getDashboardLayout("channel-1");

    expect(result).toEqual(layout);
    expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/dashboard-layout/channel-1");
  });

  it("saves a dashboard layout", async () => {
    const layout: DashboardLayout = [{ i: "activity", x: 2, y: 1, w: 3, h: 4 }];

    await saveDashboardLayout("channel-2", layout);

    expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/dashboard-layout", {
      method: "POST",
      body: JSON.stringify({ channelId: "channel-2", layout }),
    });
  });

  it("resets a dashboard layout", async () => {
    await resetDashboardLayout("channel-3");

    expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/dashboard-layout/channel-3", {
      method: "DELETE",
    });
  });

  it("propagates request failures", async () => {
    mockHttpClient.mockRejectedValueOnce(new Error("layout failed"));

    await expect(getDashboardLayout("channel-4")).rejects.toThrow("layout failed");
  });
});
