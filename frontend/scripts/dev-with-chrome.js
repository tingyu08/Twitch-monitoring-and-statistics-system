const { exec, spawn } = require("child_process");
const http = require("http");
const path = require("path");

// Chrome 路徑
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

// 檢查伺服器是否已啟動
function checkServer(callback, maxAttempts = 30) {
  let attempts = 0;
  const check = () => {
    attempts++;
    const req = http.get("http://localhost:3000", (res) => {
      callback();
    });
    req.on("error", () => {
      if (attempts < maxAttempts) {
        setTimeout(check, 1000);
      } else {
        console.log("伺服器啟動超時，但仍會嘗試開啟瀏覽器...");
        callback();
      }
    });
  };
  check();
}

// 開啟 Chrome 瀏覽器
function openChrome() {
  console.log("正在使用 Chrome 開啟瀏覽器...");
  // 使用 start 命令開啟 Chrome（Windows）
  exec(`start "" "${chromePath}" "http://localhost:3000"`, (err) => {
    if (err) {
      console.error("無法開啟 Chrome:", err.message);
      console.log("請手動在瀏覽器中開啟 http://localhost:3000");
    }
  });
}

// 啟動 Next.js 開發伺服器（禁用自動開啟瀏覽器）
const projectRoot = path.join(__dirname, "..");

// 使用 exec 執行 next dev（更相容 Node.js v24）
const nextDev = exec("npx next dev", {
  cwd: projectRoot,
  env: {
    ...process.env,
    BROWSER: "none", // 禁用 Next.js 的自動開啟
  },
});

// 將輸出導向到控制台
nextDev.stdout.pipe(process.stdout);
nextDev.stderr.pipe(process.stderr);

// 等待伺服器啟動後開啟 Chrome
checkServer(() => {
  openChrome();
}, 30);

nextDev.on("close", (code) => {
  process.exit(code);
});
