FROM node:22
LABEL "language"="nodejs"
LABEL "framework"="express"

WORKDIR /src

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# 複製所有 package.json（利用 Docker layer cache）
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
COPY extension/package*.json ./extension/

# 安裝依賴（隱藏 deprecated 警告，這些來自第三方子依賴無法直接修正）
RUN npm install --loglevel=error

# 複製所有原始碼
COPY . .

# 建構 backend
RUN npm --workspace backend run build

EXPOSE 8080

# 啟動（使用記憶體優化參數）
CMD ["node", "--expose-gc", "--max-old-space-size=460", "backend/dist/server.js"]
