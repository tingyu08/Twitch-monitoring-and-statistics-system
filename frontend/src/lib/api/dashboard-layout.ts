import { httpClient } from "./httpClient";

// React Grid Layout Type
export type DashboardLayout = any[];

export const getDashboardLayout = async (
  channelId: string
): Promise<DashboardLayout | null> => {
  const data = await httpClient<{ layout: DashboardLayout }>(
    `/api/viewer/dashboard-layout/${channelId}`
  );
  return data.layout;
};

export const saveDashboardLayout = async (
  channelId: string,
  layout: DashboardLayout
): Promise<void> => {
  await httpClient("/api/viewer/dashboard-layout", {
    method: "POST",
    body: JSON.stringify({ channelId, layout }),
  });
};

export const resetDashboardLayout = async (
  channelId: string
): Promise<void> => {
  await httpClient(`/api/viewer/dashboard-layout/${channelId}`, {
    method: "DELETE",
  });
};
