import { api } from "./index";

// React Grid Layout Type
export type DashboardLayout = any[];

export const getDashboardLayout = async (
  channelId: string
): Promise<DashboardLayout | null> => {
  const { data } = await api.get<{ layout: DashboardLayout }>(
    `/viewer/dashboard-layout/${channelId}`
  );
  return data.layout;
};

export const saveDashboardLayout = async (
  channelId: string,
  layout: DashboardLayout
): Promise<void> => {
  await api.post("/viewer/dashboard-layout", { channelId, layout });
};

export const resetDashboardLayout = async (
  channelId: string
): Promise<void> => {
  await api.delete(`/viewer/dashboard-layout/${channelId}`);
};
