FROM node:22
LABEL "language"="nodejs"
LABEL "framework"="express"

WORKDIR /src

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# 複製 backend package.json（利用 Docker layer cache）
COPY backend/package*.json ./backend/

# 安裝 backend 依賴
RUN cd backend && npm install --loglevel=error

# 複製 backend 原始碼
COPY backend ./backend

# 建構 backend
RUN cd backend && npm run build

EXPOSE 8080

# 啟動（使用記憶體優化參數）
CMD ["node", "--expose-gc", "--max-old-space-size=460", "backend/dist/server.js"]
