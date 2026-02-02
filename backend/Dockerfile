# 使用 Node.js 20 官方映像（已包含 OpenSSL）
FROM node:20-slim

# 安裝 OpenSSL 和其他必要工具
RUN apt-get update -y && \
    apt-get install -y openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# 設定工作目錄
WORKDIR /app

# 複製 package files（利用 Docker layer cache）
COPY package*.json ./

# 安裝生產依賴
RUN npm ci --only=production

# 複製所有原始碼（包含 prisma schema）
COPY . .

# 生成 Prisma Client 並編譯 TypeScript
RUN npm run build

# 暴露端口
EXPOSE 4000

# 設定環境變數
ENV NODE_ENV=production

# 啟動應用（使用與 package.json 相同的命令）
CMD ["node", "--expose-gc", "--max-old-space-size=460", "dist/server.js"]
