import { prisma } from './src/db/prisma';
import { signToken } from './src/modules/auth/jwt.utils';

/**
 * Generate a test JWT token from the first streamer in the database
 * @returns {Promise<string>} JWT token for testing
 * @throws {Error} If no streamer found in database
 */
export async function generateTestToken(): Promise<string> {
  // 取得測試實況主
  const streamer = await prisma.streamer.findFirst({
    include: { channels: true }
  });

  if (!streamer) {
    throw new Error('❌ No streamer found in database. Run: npm run db:seed');
  }

  if (!streamer.channels || streamer.channels.length === 0) {
    throw new Error('❌ Streamer has no channels. Run: npm run db:seed');
  }

  const channel = streamer.channels[0];

  // 建立 JWT Token
  const token = signToken({
    streamerId: streamer.id,
    twitchUserId: streamer.twitchUserId,
    displayName: streamer.displayName,
    avatarUrl: streamer.avatarUrl || '',
    channelUrl: channel?.channelUrl || '',
  });

  return token;
}

async function main() {
  try {
    const token = await generateTestToken();

    const streamer = await prisma.streamer.findFirst({
      include: { channels: true }
    });

    console.log('=== Test Streamer Data ===');
    console.log('Streamer ID:', streamer!.id);
    console.log('Display Name:', streamer!.displayName);
    console.log('Channel:', streamer!.channels[0]?.channelName);

    console.log('\n=== JWT Token ===');
    console.log(token);

    console.log('\n=== Test API with curl ===');
    console.log('curl -X GET "http://localhost:4000/api/streamer/me/summary?range=30d" \\');
    console.log(`  -H "Cookie: auth_token=${token}"`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Only run main if this file is executed directly
if (require.main === module) {
  main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
