import { prisma } from "../../db/prisma";

export class DashboardLayoutService {
  async getLayout(viewerId: string, channelId: string) {
    const layout = await prisma.viewerDashboardLayout.findUnique({
      where: { viewerId_channelId: { viewerId, channelId } },
    });
    return layout ? JSON.parse(layout.layout) : null;
  }

  async saveLayout(viewerId: string, channelId: string, layout: unknown) {
    const layoutStr = JSON.stringify(layout);
    return prisma.viewerDashboardLayout.upsert({
      where: { viewerId_channelId: { viewerId, channelId } },
      create: {
        viewerId,
        channelId,
        layout: layoutStr,
      },
      update: {
        layout: layoutStr,
      },
    });
  }

  async resetLayout(viewerId: string, channelId: string) {
    try {
      return await prisma.viewerDashboardLayout.delete({
        where: { viewerId_channelId: { viewerId, channelId } },
      });
    } catch {
      throw new Error("Invalid layout format");
    }
  }
}

export const dashboardLayoutService = new DashboardLayoutService();
