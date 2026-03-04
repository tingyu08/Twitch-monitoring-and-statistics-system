import { prisma } from "../db/prisma";
import { twurpleVideoService } from "../services/twitch-video.service";

type Args = {
  streamerId: string;
  twitchUserId?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--streamerId" && next) {
      args.streamerId = next;
      i++;
      continue;
    }

    if (arg === "--twitchUserId" && next) {
      args.twitchUserId = next;
      i++;
      continue;
    }
  }

  if (!args.streamerId) {
    throw new Error("Missing required argument: --streamerId <id>");
  }

  return args as Args;
}

async function main(): Promise<void> {
  const { streamerId, twitchUserId } = parseArgs(process.argv.slice(2));

  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    select: {
      id: true,
      displayName: true,
      twitchUserId: true,
    },
  });

  if (!streamer) {
    throw new Error(`Streamer not found: ${streamerId}`);
  }

  const resolvedTwitchUserId = twitchUserId || streamer.twitchUserId;
  if (!resolvedTwitchUserId) {
    throw new Error(`Streamer ${streamerId} has no twitchUserId`);
  }

  const beforeCount = await prisma.clip.count({ where: { streamerId } });

  console.log(
    `[CLIP_SYNC] Start sync for streamer=${streamer.id} (${streamer.displayName}), twitchUserId=${resolvedTwitchUserId}, beforeCount=${beforeCount}`
  );

  await twurpleVideoService.syncClips(resolvedTwitchUserId, streamerId);

  const afterCount = await prisma.clip.count({ where: { streamerId } });
  const delta = afterCount - beforeCount;

  console.log(
    `[CLIP_SYNC] Done for streamer=${streamer.id}, afterCount=${afterCount}, delta=${delta >= 0 ? `+${delta}` : delta}`
  );
}

main()
  .catch((error) => {
    console.error("[CLIP_SYNC] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
