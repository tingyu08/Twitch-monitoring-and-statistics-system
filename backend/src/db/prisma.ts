import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import * as path from 'path';

// 使用單例模式確保只有一個 Prisma Client 實例
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// 建立 libSQL 適配器（用於 SQLite）
const databaseUrl = process.env.DATABASE_URL || `file:${path.join(__dirname, '../../prisma/dev.db')}`;
const adapter = new PrismaLibSql({ url: databaseUrl });

export const prisma = global.prisma || new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'error', 'warn']
    : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

export default prisma;
