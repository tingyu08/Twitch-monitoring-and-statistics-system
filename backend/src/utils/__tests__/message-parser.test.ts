/**
 * message-parser.ts 單元測試
 *
 * 測試範圍：
 * - MessageParser.fromRawMessage：類型轉換與欄位對應
 * - MessageParser.parseChatMessage：一般聊天訊息與 Cheer 訊息
 * - MessageParser.parseSubscription：訂閱訊息
 * - MessageParser.parseGiftSubscription：贈送訂閱
 * - normalizeMessageType：所有訊息類型標準化（含未知類型 fallback）
 */

import { MessageParser, RawChatMessage } from "../message-parser";

const makeRawMessage = (overrides: Partial<RawChatMessage> = {}): RawChatMessage => ({
  viewerId: "user_123",
  username: "testuser",
  displayName: "TestUser",
  messageText: "Hello world",
  messageType: "CHAT",
  timestamp: new Date("2024-01-15T10:00:00Z"),
  badges: null,
  bitsAmount: null,
  emotesUsed: null,
  ...overrides,
});

describe("MessageParser.fromRawMessage", () => {
  it("應正確轉換一般聊天訊息", () => {
    const raw = makeRawMessage();
    const parsed = MessageParser.fromRawMessage(raw);

    expect(parsed.twitchUserId).toBe("user_123");
    expect(parsed.displayName).toBe("TestUser");
    expect(parsed.messageText).toBe("Hello world");
    expect(parsed.messageType).toBe("CHAT");
    expect(parsed.timestamp).toEqual(new Date("2024-01-15T10:00:00Z"));
    expect(parsed.badges).toBeNull();
    expect(parsed.emotes).toBeNull();
    expect(parsed.bits).toBe(0);
  });

  it("應正確轉換 SUBSCRIPTION 類型", () => {
    const raw = makeRawMessage({ messageType: "SUBSCRIPTION" });
    const parsed = MessageParser.fromRawMessage(raw);
    expect(parsed.messageType).toBe("SUBSCRIPTION");
  });

  it("應正確轉換 CHEER 類型", () => {
    const raw = makeRawMessage({ messageType: "CHEER", bitsAmount: 100 });
    const parsed = MessageParser.fromRawMessage(raw);
    expect(parsed.messageType).toBe("CHEER");
    expect(parsed.bits).toBe(100);
  });

  it("應正確轉換 RAID 類型", () => {
    const raw = makeRawMessage({ messageType: "RAID" });
    const parsed = MessageParser.fromRawMessage(raw);
    expect(parsed.messageType).toBe("RAID");
  });

  it("應正確轉換 GIFT_SUBSCRIPTION 類型", () => {
    const raw = makeRawMessage({ messageType: "GIFT_SUBSCRIPTION" });
    const parsed = MessageParser.fromRawMessage(raw);
    expect(parsed.messageType).toBe("GIFT_SUBSCRIPTION");
  });

  it("未知類型應 fallback 為 CHAT", () => {
    const raw = makeRawMessage({ messageType: "UNKNOWN_TYPE" });
    const parsed = MessageParser.fromRawMessage(raw);
    expect(parsed.messageType).toBe("CHAT");
  });

  it("訊息類型不區分大小寫", () => {
    const raw = makeRawMessage({ messageType: "subscription" });
    const parsed = MessageParser.fromRawMessage(raw);
    expect(parsed.messageType).toBe("SUBSCRIPTION");
  });

  it("bitsAmount 為 null 時 bits 應為 0", () => {
    const raw = makeRawMessage({ bitsAmount: null });
    const parsed = MessageParser.fromRawMessage(raw);
    expect(parsed.bits).toBe(0);
  });

  it("應正確傳遞 badges 和 emotes", () => {
    const badges = { subscriber: "12", bits: "100" };
    const emotes = ["Kappa", "PogChamp"];
    const raw = makeRawMessage({ badges, emotesUsed: emotes });
    const parsed = MessageParser.fromRawMessage(raw);
    expect(parsed.badges).toEqual(badges);
    expect(parsed.emotes).toEqual(emotes);
  });
});

describe("MessageParser.parseChatMessage", () => {
  it("應建立一般聊天訊息（無 bits）", () => {
    const parsed = MessageParser.parseChatMessage("user_1", "Alice", "Hello!");
    expect(parsed.twitchUserId).toBe("user_1");
    expect(parsed.displayName).toBe("Alice");
    expect(parsed.messageText).toBe("Hello!");
    expect(parsed.messageType).toBe("CHAT");
    expect(parsed.bits).toBe(0);
    expect(parsed.badges).toBeNull();
    expect(parsed.emotes).toBeNull();
  });

  it("有 bits 時應建立 CHEER 訊息", () => {
    const parsed = MessageParser.parseChatMessage("user_1", "Alice", "cheer100", 100);
    expect(parsed.messageType).toBe("CHEER");
    expect(parsed.bits).toBe(100);
  });

  it("bits 為 0 時應為 CHAT 類型", () => {
    const parsed = MessageParser.parseChatMessage("user_1", "Alice", "hello", 0);
    expect(parsed.messageType).toBe("CHAT");
    expect(parsed.bits).toBe(0);
  });

  it("應傳遞 badges 和 emotes", () => {
    const badges = { moderator: "1" };
    const emotes = ["Kappa"];
    const parsed = MessageParser.parseChatMessage("user_1", "Alice", "hello", undefined, badges, emotes);
    expect(parsed.badges).toEqual(badges);
    expect(parsed.emotes).toEqual(emotes);
  });

  it("timestamp 應為當前時間（Date 類型）", () => {
    const before = new Date();
    const parsed = MessageParser.parseChatMessage("user_1", "Alice", "hello");
    const after = new Date();
    expect(parsed.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(parsed.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

describe("MessageParser.parseSubscription", () => {
  it("應建立 SUBSCRIPTION 類型訊息", () => {
    const parsed = MessageParser.parseSubscription("user_1", "Alice", "Thanks for the sub!");
    expect(parsed.twitchUserId).toBe("user_1");
    expect(parsed.displayName).toBe("Alice");
    expect(parsed.messageText).toBe("Thanks for the sub!");
    expect(parsed.messageType).toBe("SUBSCRIPTION");
    expect(parsed.bits).toBe(0);
    expect(parsed.badges).toBeNull();
    expect(parsed.emotes).toBeNull();
  });

  it("timestamp 應為當前時間", () => {
    const before = new Date();
    const parsed = MessageParser.parseSubscription("user_1", "Alice", "message");
    const after = new Date();
    expect(parsed.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(parsed.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

describe("MessageParser.parseGiftSubscription", () => {
  it("應建立 GIFT_SUBSCRIPTION 類型訊息", () => {
    const parsed = MessageParser.parseGiftSubscription("user_1", "Alice", "Bob");
    expect(parsed.twitchUserId).toBe("user_1");
    expect(parsed.displayName).toBe("Alice");
    expect(parsed.messageText).toBe("Gifted sub to Bob");
    expect(parsed.messageType).toBe("GIFT_SUBSCRIPTION");
    expect(parsed.bits).toBe(0);
    expect(parsed.badges).toBeNull();
    expect(parsed.emotes).toBeNull();
  });

  it("應正確格式化 messageText", () => {
    const parsed = MessageParser.parseGiftSubscription("user_1", "Alice", "Charlie");
    expect(parsed.messageText).toBe("Gifted sub to Charlie");
  });
});
