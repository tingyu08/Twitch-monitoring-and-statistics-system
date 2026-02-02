# 使用完整 Node.js 20 映像（包含 libssl）
FROM node:20-bookworm

# 確保 OpenSSL 函式庫可用（Prisma 需要 libssl）
RUN apt-get update -y && \
    apt-get install -y openssl libssl3 ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    openssl version

# 設定工作目錄
WORKDIR /app

# 複製 package files（利用 Docker layer cache）
COPY package*.json ./

# 安裝生產依賴（隱藏 deprecation 警告）
RUN npm ci --only=production --silent 2>&1 | grep -v "deprecated" || true

# 複製所有原始碼（包含 prisma schema）
COPY . .

# 生成 Prisma Client 並編譯 TypeScript
# 設定 Prisma 使用正確的 OpenSSL 版本（消除警告）
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node
RUN npm run build 2>&1 | grep -v "prisma:warn" || true

# 暴露端口（Zeabur 會動態設定 PORT 環境變數）
EXPOSE 8080

# 設定環境變數
ENV NODE_ENV=production
# 告訴 Prisma 使用 OpenSSL 3.0（Debian Bookworm 預設版本）
ENV PRISMA_CLI_BINARY_TARGETS=debian-openssl-3.0.x

# 啟動應用（使用與 package.json 相同的命令）
CMD ["node", "--expose-gc", "--max-old-space-size=460", "dist/server.js"]
