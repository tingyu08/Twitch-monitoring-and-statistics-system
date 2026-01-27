/**
 * 一次性腳本：更新所有缺少頭像的 Streamer 記錄
 * 執行方式：npx ts-node src/scripts/update-missing-avatars.ts
 */
import { prisma } from "../db/prisma";
import { twurpleHelixService } from "../services/twitch-helix.service";

async function updateMissingAvatars() {
  console.log("🔄 開始更新缺少頭像的 Streamer 記錄...\n");

  // 找出所有沒有頭像的 Streamer
  const streamersWithoutAvatar = await prisma.streamer.findMany({
    where: {
      OR: [{ avatarUrl: "" }, { avatarUrl: null }],
    },
    select: {
      id: true,
      twitchUserId: true,
      displayName: true,
    },
  });

  console.log(`📋 找到 ${streamersWithoutAvatar.length} 個缺少頭像的 Streamer\n`);

  if (streamersWithoutAvatar.length === 0) {
    console.log("✅ 沒有需要更新的記錄！");
    return;
  }

  let updated = 0;
  let failed = 0;

  // 分批處理以避免 Rate Limit（每批 100 個，間隔 1 秒）
  const batchSize = 100;
  for (let i = 0; i < streamersWithoutAvatar.length; i += batchSize) {
    const batch = streamersWithoutAvatar.slice(i, i + batchSize);
    const twitchIds = batch.map((s) => s.twitchUserId);

    try {
      // 批量獲取用戶資訊
      const users = await twurpleHelixService.getUsersByIds(twitchIds);

      // 收集需要更新的資料
      const updates: { id: string; avatarUrl: string; displayName: string; oldName: string }[] = [];
      for (const streamer of batch) {
        const user = users.find((u) => u.id === streamer.twitchUserId);
        if (user?.profileImageUrl) {
          updates.push({
            id: streamer.id,
            avatarUrl: user.profileImageUrl,
            displayName: user.displayName || streamer.displayName,
            oldName: streamer.displayName,
          });
        } else {
          console.log(`⚠️ 跳過: ${streamer.displayName} (無法獲取資訊)`);
          failed++;
        }
      }

      // 使用 transaction 批量更新
      if (updates.length > 0) {
        await prisma.$transaction(
          updates.map((u) =>
            prisma.streamer.update({
              where: { id: u.id },
              data: { avatarUrl: u.avatarUrl, displayName: u.displayName },
            })
          )
        );
        for (const u of updates) {
          console.log(`✅ 更新: ${u.oldName} -> ${u.avatarUrl.substring(0, 50)}...`);
          updated++;
        }
      }

      // 每批之間等待 1 秒
      if (i + batchSize < streamersWithoutAvatar.length) {
        console.log(`\n⏳ 等待 1 秒避免 Rate Limit...\n`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`❌ 批次處理失敗:`, error);
      failed += batch.length;
    }
  }

  console.log(`\n📊 完成！`);
  console.log(`   ✅ 成功更新: ${updated}`);
  console.log(`   ⚠️ 失敗/跳過: ${failed}`);
}

// 執行
updateMissingAvatars()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("腳本執行失敗:", error);
    process.exit(1);
  });
