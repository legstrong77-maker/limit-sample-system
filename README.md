# 📋 限樣系統 (Limit Sample System)

> 給品管團隊的限度樣品查詢與管理平台。離線可用、手機友善、整合 LINE Bot。

🌐 **線上網址**：https://legstrong77-maker.github.io/limit-sample-system/

---

## ✨ 主要特色

- 🚀 **極速搜尋** — localStorage 快取 + Stale-While-Revalidate，第二次開站幾乎瞬間呈現
- 📱 **手機優先** — PWA 可加到主畫面、相機快拍、條碼掃描、語音輸入
- 📡 **離線可用** — Service Worker 預熱所有縮圖；斷網時編輯自動排隊，連線恢復回放
- 🔐 **多人權限** — 最高權限可開分密碼；所有操作有 audit log
- 🎨 **創造工具** — 照片標註器（自由筆/矩形/箭頭）、手寫便條、AR 對照
- 💬 **LINE Bot 整合** — 私訊或群組查詢限樣，自動回照片

---

## 🎯 使用情境

```
品管人員
   ↓ 拍照建檔  ────────► 限樣資料庫 (Google Sheets + Drive)
   ↓ 寫注意事項              ↑
                              │
產線員工 ─── 查詢品號 ────────┤
LINE 群組 ── /品號 ───────────┘
                              │
業務客戶 ─── QR Code 分享 ────┘
```

---

## 📦 功能總覽

### 🔍 查詢模式（無需登入）

| 功能 | 說明 |
|---|---|
| 模糊搜尋 | 品號 / 注意事項 / `#標籤` 全文搜尋 |
| 條碼掃描 | 搜尋框 📷 → 對著商品條碼掃即填入 |
| 鍵盤快捷 | 任何頁面按 `/` 聚焦搜尋框 |
| QR 分享 | 每個品號可生成 QR，掃了直接跳到該品號 |
| 列印 | 卡片 🖨️ 開新視窗排版好自動列印 |
| 歡迎面板 | 統計概覽 + 最近瀏覽 chips |

### ⚙️ 管理模式（需密碼）

| 功能 | 說明 |
|---|---|
| 新增 / 編輯 / 刪除 | 二次確認刪除（必須打字輸入品號）|
| 重複偵測 | 新增重複品號自動跳「合併 / 新建 / 取消」對話 |
| 拖曳排序 | 編輯時拖照片，第一張變封面 |
| 到期提醒 | 設到期日 → 30 天內自動標紅徽章 |
| 多選批次 | 批次列印 / 批次刪除 / 並排比較 / 製作交付單 |
| 統計儀表板 | 總品號 / 總媒體 / 7 日新增 / 即將到期 |
| 查詢統計 | 本機累計 Top 20 熱門品號 + 30 天活躍度 |
| 熱力圖 | Canvas 視覺化：時間 × 群組 × 媒體數 × 熱度 |
| 變更紀錄 | Audit log：誰、何時、改了什麼（最高權限） |
| 密碼管理 | 多人共用，獨立密碼 + 備註（最高權限） |

### 🎨 創造工具

| 功能 | 說明 |
|---|---|
| 照片標註器 | 自由筆 / 矩形 / 箭頭，5 色 + 3 粗細，存為新照片不動原檔 |
| 手寫便條 | 米黃色便條紙底，用觸控筆/手指寫便條 |
| AR 對照 | 開相機 + 限樣圖 difference 混合，調透明度對齊實品 |
| 歷史版本 | 同品號所有版本依類型分區（照片/標註/便條/影片） |

### 📥📤 資料交換

| 功能 | 說明 |
|---|---|
| CSV 匯出 | 含 BOM，Excel 直開無亂碼 |
| CSV 匯入 | 批次更新既有品號的注意事項，預覽差異後確認 |
| 限樣交付單 | 多選 → A4 列印單，含表格 + 簽章區 |
| QR Code | 深連結 `#productId=XXX`，分享給客戶 |

### 📱 PWA / 離線

| 功能 | 說明 |
|---|---|
| 加到主畫面 | 手機 Chrome 選單 → 加到主畫面 → 變成 app icon |
| Service Worker | App shell + Drive 縮圖 cache-first |
| 背景預熱 | 啟動後 idle 時段把所有縮圖塞進 cache |
| 離線編輯佇列 | 斷網時編輯自動排隊，online event 一鍵 flush |
| 離線指示 banner | 紅黃漸層 + 脈動點 + 佇列數量 |

### 🌙 體驗

- 暗 / 亮主題切換（localStorage 記憶）
- 卡片 hover 動畫 + glassmorphism
- 搜尋結果黃色 `<mark>` 高亮
- 鍵盤快捷鍵：`/` 聚焦、`ESC` 關閉

### 💬 LINE Bot

- **1 對 1**：直接傳品號 → 回文字 + 4 張照片
- **群組**：必須 `/品號` 觸發，找不到靜默不擾民
- 模糊比對：多筆候選會列出讓使用者選

---

## 🏗️ 技術架構

```
┌──────────────────────────────────────────────┐
│  前端 (GitHub Pages)                          │
│  - index.html / app.js / style.css            │
│  - sw.js (Service Worker)                     │
│  - manifest.webmanifest (PWA)                 │
│  - 純 vanilla JS + qrcode-generator (5KB)     │
└────────────────┬─────────────────────────────┘
                 │ fetch (JSON)
                 ▼
┌──────────────────────────────────────────────┐
│  後端 (Google Apps Script Web App)            │
│  - doGet / doPost                             │
│  - CacheService (10 min) + MD5 hash 短路      │
└─────┬────────────────────────────┬───────────┘
      │                            │
      ▼                            ▼
┌─────────────┐           ┌─────────────────┐
│ Google      │           │ Google Drive    │
│ Sheets      │           │ (圖片/影片檔)    │
│             │           │                 │
│ - 限樣資料   │           └─────────────────┘
│ - 密碼管理   │
│ - 登入紀錄   │           ┌─────────────────┐
│ - 變更紀錄   │           │ LINE Messaging  │
└─────────────┘           │ API (Webhook)   │
                          └─────────────────┘
```

### 為什麼這個架構

- **GAS 後端**：免費、無限期、自動 scale、與 Sheets/Drive 原生整合
- **GitHub Pages**：免費 host、自動部署、global CDN
- **Drive 縮圖 URL**：`drive.google.com/thumbnail?id=XXX&sz=w400`，省去自架圖床
- **localStorage SWR**：實際資料量大時，從 GAS 拉一次要幾秒，但快取後瞬間呈現

---

## 📂 目錄結構

```
限樣系統/
├── index.html              # 主頁面
├── app.js                  # 前端所有邏輯 (~3000 行)
├── config.js               # API_URL 設定
├── style.css               # 樣式
├── sw.js                   # Service Worker (PWA)
├── manifest.webmanifest    # PWA manifest
├── gas/
│   └── Code.gs             # Google Apps Script 後端 (~800 行)
├── README.md               # 本檔案
├── DEVLOG.md               # 開發歷程
└── LINE_BOT_INTRO.md       # LINE Bot 文案
```

---

## 🚀 部署方式

### 1. 前端（GitHub Pages）

已自動部署。push 到 `master` → GitHub Actions 自動 build → 1-2 分鐘上線。

### 2. 後端（Google Apps Script）

1. 開 [Google Sheets](https://sheets.google.com/) 建一份試算表，記下 ID（網址中間那串）
2. 開 [GAS](https://script.google.com/) 建新專案
3. 把 `gas/Code.gs` 整份貼上
4. 修改 `SHEET_ID`、`DRIVE_FOLDER_ID`、`ADMIN_PASSWORD` 三個常數
5. 部署 → 新增部署 → 類型選「Web App」
   - 執行身分：**我**
   - 具有存取權的使用者：**任何人**
6. 拿到 Web App URL → 填進 `config.js` 的 `API_URL`
7. push → 前端自動部署

### 3. LINE Bot（可選）

1. [LINE Developers Console](https://developers.line.biz/console/) → 建 Provider + Channel (Messaging API)
2. 取「Channel access token (long-lived)」
3. GAS 編輯器 → 齒輪「專案設定」→ 指令碼屬性 → 新增：
   - `LINE_CHANNEL_TOKEN` = （你的 token）
4. LINE Console → Messaging API：
   - Webhook URL = GAS Web App URL
   - Use webhook = ✅
   - Auto-reply messages = ❌（一定要關）
   - Allow bot to join group chats = ✅（要群組功能才開）
5. 加 Bot 為好友 → 傳訊息測試

---

## 🛡️ 安全注意

- LINE token **不要寫死在 Code.gs**，用 `PropertiesService` 存
- `ADMIN_PASSWORD` 在 Code.gs 是明碼，repo 是 public 要避免敏感密碼
- 副密碼存在 Sheets「密碼管理」分頁，明碼但只有有 sheet 權限者看得到
- 所有 admin 操作都會記錄到「變更紀錄」分頁，附帶使用密碼

---

## 🧪 開發 / 除錯小技巧

- **強制刷新**：`Ctrl+Shift+R` 清快取拿新版 JS
- **強制重抓資料**：DevTools console 跑 `fetchGlobalData(true)`
- **GAS debug 工具**：選 `debugLineToken` / `debugSimulateLineMessage` 執行
- **看 GAS 執行紀錄**：GAS 編輯器左側「執行作業」分頁
- **清快取**：DevTools → Application → Service Workers → Unregister

---

## 📈 效能數據

| 操作 | 耗時 |
|---|---|
| 第一次開站（無 cache） | ~2 秒 |
| 第二次開站（SWR） | **<100ms** |
| 背景刷新（資料無變動） | ~80 bytes 回應 |
| 搜尋（資料已快取） | **0ms**（純 JS filter） |
| 縮圖載入（SW cache hit） | 0ms |

---

## 📜 授權

私人專案，內部使用。

---

## 🙏 致謝

- 主要開發：[@legstrong77-maker](https://github.com/legstrong77-maker)
- 共同開發：Claude Opus 4.7 (Anthropic)
