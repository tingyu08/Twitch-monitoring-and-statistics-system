/**
 * Tests for db/prisma 啟動時的連線目標描述
 * 2026-10 從 Supabase 搬到 VPS 本機 PostgreSQL 後，log 仍寫死「Supabase」而誤導判讀；
 * 改成印出實際的主機，且絕不能帶出帳號或密碼。
 */

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@prisma/adapter-pg", () => ({
  PrismaPg: jest.fn(),
}));

jest.mock("../slow-query-logger", () => ({
  setupSlowQueryLogger: (client: unknown) => client,
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

type PrismaModule = typeof import("../prisma");

// prisma.ts 在載入時就讀 DATABASE_URL 並寫 log，每次都要重新載入
async function loadPrismaModule(databaseUrl: string): Promise<{
  mod: PrismaModule;
  infoLogs: string[];
}> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  try {
    jest.resetModules();
    const mod = await import("../prisma");
    const info = (await import("../../utils/logger")).logger.info as jest.Mock;
    return {
      mod,
      infoLogs: info.mock.calls.map((args: unknown[]) => args.map(String).join(" ")),
    };
  } finally {
    if (previous === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previous;
    }
  }
}

describe("describeDatabaseTarget", () => {
  let describeDatabaseTarget: PrismaModule["describeDatabaseTarget"];

  beforeAll(async () => {
    ({ describeDatabaseTarget } = (
      await loadPrismaModule("postgresql://u:p@localhost:5432/db")
    ).mod);
  });

  it("顯示主機、埠與資料庫名稱", () => {
    expect(describeDatabaseTarget("postgresql://twitch:s3cret@twitch-db:5432/twitch")).toBe(
      "PostgreSQL @ twitch-db:5432/twitch"
    );
  });

  it("不帶出帳號、密碼與查詢參數", () => {
    const description = describeDatabaseTarget(
      "postgresql://postgres.abcdef:topsecret@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
    );

    expect(description).toBe("PostgreSQL @ aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres");
    expect(description).not.toContain("topsecret");
    expect(description).not.toContain("abcdef");
    expect(description).not.toContain("pgbouncer");
  });

  it("沒寫埠時使用 PostgreSQL 預設埠 5432", () => {
    expect(describeDatabaseTarget("postgres://u:p@db.example.com/app")).toBe(
      "PostgreSQL @ db.example.com:5432/app"
    );
  });

  it("無法解析時不回傳原字串（可能含密碼）", () => {
    const description = describeDatabaseTarget("not a url with password hunter2");

    expect(description).toBe("PostgreSQL @ (無法解析的連線字串)");
    expect(description).not.toContain("hunter2");
  });
});

describe("db/prisma 啟動 log", () => {
  it("印出實際連線的主機，不再寫死 Supabase，也不洩漏密碼", async () => {
    const { infoLogs } = await loadPrismaModule("postgresql://twitch:s3cret@twitch-db:5432/twitch");

    const dbLog = infoLogs.find((line) => line.includes("資料庫"));
    expect(dbLog).toContain("PostgreSQL @ twitch-db:5432/twitch");
    expect(infoLogs.join("\n")).not.toContain("Supabase");
    expect(infoLogs.join("\n")).not.toContain("s3cret");
  });
});
