import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MOCK_CHANNEL_MAP: Record<
  string,
  { name: string; display: string; avatarUrl: string }
> = {
  ch_1: {
    name: "shroud",
    display: "Shroud",
    avatarUrl: "https://ui-avatars.com/api/?name=Shroud&background=random",
  },
  ch_2: {
    name: "pokimane",
    display: "Pokimane",
    avatarUrl: "https://ui-avatars.com/api/?name=Pokimane&background=random",
  },
  ch_3: {
    name: "xqcow",
    display: "xQc",
    avatarUrl: "https://ui-avatars.com/api/?name=xQc&background=random",
  },
  ch_4: {
    name: "lilypichu",
    display: "LilyPichu",
    avatarUrl: "https://ui-avatars.com/api/?name=LilyPichu&background=random",
  },
  ch_5: {
    name: "disguisedtoast",
    display: "DisguisedToast",
    avatarUrl:
      "https://ui-avatars.com/api/?name=DisguisedToast&background=random",
  },
};

async function main() {
  console.log("Fixing avatars...");

  for (const [id, info] of Object.entries(MOCK_CHANNEL_MAP)) {
    console.log(`Updating channel ${id} - ${info.name}...`);

    // update channel
    try {
      await prisma.channel.update({
        where: { id },
        data: {
          channelName: info.name,
        },
      });

      // update streamer (we need to find streamerId first)
      const channel = await prisma.channel.findUnique({ where: { id } });
      if (channel && channel.streamerId) {
        await prisma.streamer.update({
          where: { id: channel.streamerId },
          data: {
            displayName: info.display,
            avatarUrl: info.avatarUrl,
          },
        });
      }
    } catch (e) {
      console.log(`Skipping channel ${id}: not found or error`, e);
    }
  }

  console.log("Done!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
