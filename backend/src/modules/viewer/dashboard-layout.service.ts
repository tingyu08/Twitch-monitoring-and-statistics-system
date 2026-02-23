import { prisma } from "../../db/prisma";
import { z } from "zod";

const layoutItemSchema = z.object({
  i: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  minW: z.number().int().positive().optional(),
  maxW: z.number().int().positive().optional(),
  minH: z.number().int().positive().optional(),
  maxH: z.number().int().positive().optional(),
});

const dashboardLayoutSchema = z.array(layoutItemSchema).max(100);

export class DashboardLayoutService {
  async getLayout(viewerId: string, channelId: string) {
    const layout = await prisma.viewerDashboardLayout.findUnique({
      where: { viewerId_channelId: { viewerId, channelId } },
    });

    if (!layout) {
      return null;
    }

    try {
      const parsed = JSON.parse(layout.layout);
      const validated = dashboardLayoutSchema.safeParse(parsed);
      return validated.success ? validated.data : null;
    } catch {
      return null;
    }
  }

  async saveLayout(viewerId: string, channelId: string, layout: unknown) {
    const validatedLayout = dashboardLayoutSchema.parse(layout);
    const layoutStr = JSON.stringify(validatedLayout);
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
