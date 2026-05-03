# 📜 限樣系統 — 開發歷程

> 從 2026-04-01 初始化到 2026-05-03 大規模功能擴充的完整紀錄。

---

## 📅 時間軸概覽

```
2026-04-01  Day 1  ── 初始化 + 部署 + 修圖效能 + 行動相機
2026-04-02  Day 2  ── 編輯/刪除/排序/影片 + 多人密碼 + 全域預載
                     (中間過了一個月實際使用，發現速度問題)
2026-05-03  Day 30 ── 大爆發：效能、體驗、PWA、AR、LINE Bot 全套
```

---

## 🏛️ 架構演進

### v0 — 初始版本（2026-04-01）

```
GAS (CRUD + serveImage proxy)
   ↓
GitHub Pages
   ↓
使用者瀏覽器
```

**問題**：每張圖片都過 GAS proxy，慢到不行。

### v1 — 直連 Drive thumbnail（2026-04-01 16:08）

```
GAS (CRUD only)        Drive thumbnail URL
       ↓                       ↓
       └─── HTML ──────────────┘
              ↓
        使用者瀏覽器
```

**改進**：圖片直接從 Drive CDN 拉，bypass GAS。前端壓縮上傳。

### v2 — 多人密碼 + 預載（2026-04-02）

加入：
- 「密碼管理」與「登入紀錄」sheet
- 開站時 `getAll` 一次拉全部，搜尋走前端 filter

### v3 — 多層快取 + Hash 短路（2026-05-03）

```
瀏覽器 localStorage
   ↓ (SWR 瞬間呈現)
   ↓
   ↓ 背景帶 hash 去 GAS
   ↓
GAS CacheService (10 min)
   ↓ hash 對得上 → 80 bytes 回應
   ↓ 對不上 → 重讀 Sheet → 算 MD5 → 回完整資料
   ↓
Sheet
```

**結果**：第二次開站幾乎瞬間呈現，背景刷新省 99% 流量。

### v4 — PWA + Service Worker（2026-05-03）

```
Service Worker
├── App Shell (SWR)
├── Drive Thumbnail (cache-first)
└── 攔截 fetch，背景預熱所有縮圖
```

**結果**：完全離線可用（縮圖也都在本地 Cache Storage）。

### v5 — LINE Bot 整合（2026-05-03）

```
LINE 平台
   ↓ Webhook POST
GAS doPost (偵測 events 走 LINE 路徑)
   ↓
查 Sheet 找品號
   ↓
LINE Reply API (回文字 + 圖片訊息)
```

---

## 📜 詳細 Commit 紀錄

### 🌱 Day 1 — 初始化（2026-04-01）

| Time | Commit | 說明 |
|---|---|---|
| 15:08 | `ccb2b0b` | **初始化限樣系統** |
| 15:14 | `3087dee` | 新增 GitHub Pages 部署 workflow |
| 15:15 | `c189528` | fix: workflow 加入 workflow_dispatch |
| 15:24 | `b66ed02` | 填入 API URL，系統功能完備 |
| 15:38 | `c6f3f33` | **🚀 perf**: 改 Drive 直接連結 + 前端相片壓縮 |
| 15:47 | `1168a38` | fix: 強制清除 app.js 快取 |
| 15:54 | `ddc50aa` | **📱 fix(mobile)**: 用 input capture='environment' 開原生相機 |

**Day 1 重點**：
- 系統從零到能動
- 第一輪效能優化：bypass GAS proxy 直連 Drive
- 第一個行動端問題：Android 拍照需要 capture attribute

---

### 🔧 Day 2 — 完善 CRUD + 多人協作（2026-04-02）

| Time | Commit | 說明 |
|---|---|---|
| 10:49 | `b21a2de` | fix: edit/delete modal、加排序、影片支援、admin session 持久化 |
| 10:58 | `b7ac3ca` | fix: productId 數字型強制轉字串 |
| 11:06 | `bb2ce6d` | fix: showEditModal 數字 productId 嚴格相等 bug |
| 11:11 | `9d2a55f` | fix: restoreAdminSession 沒載入資料、強化 productId 比對 |
| 16:32 | `82c4f02` | **feat**: 多人 admin + 登入紀錄 + 資料夾分組 |
| 16:41 | `4197a9f` | **🚀 perf**: 開站全域預載，搜尋瞬間 |
| 16:43 | `6178a36` | fix: 資料夾響應 adminSort 設定 |
| 16:51 | `6b761e1` | fix: 還原遺漏的 adminSort 初始狀態 |

**Day 2 重點**：
- Sheet 數字型品號 → JS 比對的隱藏 bug 重複出現（轉字串才解）
- 多人共用 admin（有歷史紀錄）
- 同 prefix 自動分組到資料夾
- 開站預載 = 第一次大改善

---

### 💤 中間一個月實際使用（2026-04-02 ~ 2026-05-03）

> 使用者反饋：「資料多了時候網站開起來就很慢」

問題根源分析：
1. 每次開站都從 GAS 拉一次全部資料（GAS 讀 Sheet 本身就慢）
2. 管理模式一次 render 所有 folder 內的圖片
3. GAS 沒有任何快取
4. localStorage 沒用，重整就重來

→ 觸發 Day 30 大改造。

---

### 🚀 Day 30 — 大爆發（2026-05-03）

#### Wave 1：效能多層次優化（17:00）

`b40800c` **perf: 多層快取 + hash 短路大幅加速載入**

四件事一次做：
- **GAS CacheService** 10 分鐘快取 `getAllSamples`
- **localStorage Stale-While-Revalidate**：開站瞬間用舊資料，背景更新
- **Folder lazy render**：folder 點開才把卡片塞進 DOM
- **Hash 短路**：客戶端帶 MD5 hash，沒變動只回 80 bytes

> 同時加：admin 統計卡 / 全文搜尋（包含 notes）/ `/` 鍵聚焦 / 卡片視覺微調

**效果**：
- 第一次開站：~2 秒
- 第二次開站：**<100ms**
- 背景刷新（無變動）：**80 bytes** vs 原本幾百 KB

#### Wave 2：分享 / 列印 / PWA（17:20）

`d186e67` **feat: 歡迎面板 / QR 分享 / CSV 列印 / PWA / 深連結**

- **歡迎面板**：問候語 + 統計 + 最近瀏覽 chips
- **QR Code 分享**：每個品號生成 QR（用 qrcode-generator lib，5KB）
- **URL 深連結**：`#productId=XXX` 自動搜尋（QR 用的就是這個）
- **CSV 匯出**：含 BOM，Excel 直開
- **單張列印**：A4 排版好自動觸發 print
- **PWA**：manifest + service worker 雙快取（app shell SWR + 縮圖 cache-first）
- **複製品號 / 搜尋高亮 / 最近瀏覽**

#### Wave 3：重複偵測 / 離線 / 標註（17:30）

`3274761` **feat: 重複品號偵測 / 離線增強 / 照片標註器**

- **重複品號偵測**：新增重複跳「合併 / 新建 / 取消」對話
- **離線 banner**：紅黃漸層 + 脈動點
- **背景預熱 thumbnail**：完成後完全離線可用
- **照片標註器**：canvas 自由筆 / 矩形 / 箭頭，5 色 + 3 粗細
  - 走 GAS serveImage proxy 載入避免 CORS taint
  - 儲存為 mediaType='annotation' 新照片，不動原檔

#### Wave 4：八大功能合一（18:51）

`4c844c3` **feat: audit log / 拖曳排序 / 多選批次 / CSV 匯入 / 條碼 / 標籤 / 統計 / 二次確認**

- **A. Audit Log**：新 sheet「變更紀錄」自動記錄所有 CRUD
- **B. 拖曳排序**：GAS 加 sortOrder 欄，編輯時拖照片，第一張變封面
- **C. 多選批次**：sticky 紫色 toolbar，批次列印 / 刪除
- **D. CSV 匯入**：預覽差異，只更新既有品號的 notes
- **E. #標籤**：從 notes 解析 #tag，純前端，點 chip 過濾
- **F. 條碼掃描**：BarcodeDetector API，掃 QR 自動抽 productId
- **G. 查詢統計**：localStorage Top 20 + 30 天 sparkline
- **H. 二次確認刪除**：必須打字輸入完整品號才能刪

#### Wave 5：手寫便條 + 比較模式（18:57）

`ab40f9e` **feat: 手寫便條 + 並排比較模式**

- **手寫便條**：mediaType='note'，米黃色便條紙 + 橫線當底
- **並排比較**：多選 2-4 個品號 → 全螢幕並排，同步縮放

#### Wave 6：十大工廠功能（19:12）

`11b4cd1` **feat: 快拍 / 語音 / 交付單 / 到期 / 離線佇列 / 歷史 / AR / LINE Bot / 主題 / 熱力圖**

- **手機快拍 FAB**：右下浮動按鈕 → 直開相機 → 簡化 modal
- **語音輸入**：Web Speech API，zh-TW 即時轉錄
- **限樣交付單**：A4 列印單 + 簽章區
- **到期提醒**：GAS 加 expiresAt 欄，30 天內標紅
- **離線編輯佇列**：斷網時 mutation 進 localStorage queue，online 自動 flush
- **歷史版本**：lightbox 加 📅 → 同品號所有版本依類型分區
- **AR 對照**：相機 + 限樣圖 difference 混合，調透明度對齊實品
- **LINE Bot**：webhook 收品號回照片
- **主題切換**：暗 / 亮（localStorage 記憶）
- **熱力圖**：canvas 視覺化（時間 × 群組 × 媒體數 × 熱度）

#### Wave 7：LINE Bot 設定與調校（19:35 ~ 19:58）

| Time | Commit | 說明 |
|---|---|---|
| 19:35 | `f2d088d` | refactor: LINE token 改從 ScriptProperties 讀取（不進 git） |
| 19:41 | `f2c9339` | debug: 加 LINE 診斷工具 + doPost log |
| 19:58 | `2a2de47` | feat(line): 群組需 `/` 觸發 + 找不到時靜默, 1 對 1 維持原狀 |

**Token 安全處理**：
- 一開始想直接寫死在 Code.gs，但 repo 是 public
- claude-code 系統擋下 push（credential leakage 偵測）
- 改用 `PropertiesService.getScriptProperties()` 讓 token 完全不進 git
- 加 `debugLineToken` 函式驗證 token 有效性

**LINE Bot 行為設計**：
- 1 對 1：任何文字都查（找不到也回提示）
- 群組：必須 `/` 開頭才查（避免擾民）
- 群組找不到 → 靜默不回

---

## 🎓 開發過程中的學到的事

### 1. SWR (Stale-While-Revalidate) 是必殺技

最有感的優化。實作只要幾十行 JS，但使用者體驗從「每次重新整理都要等」變成「秒開」。

### 2. Hash 短路（ETag-like 機制）

GAS Web App 的 response 動輒幾百 KB。用 MD5 hash 比對「資料有沒有變」→ 沒變只回 80 bytes。
- 客戶端把上次 hash 帶過去
- GAS 比對一致就回 `{notModified: true}`
- 對不上才回完整資料

### 3. Drive thumbnail URL 直連

不要用 GAS proxy 圖片！直接用 `https://drive.google.com/thumbnail?id=XXX&sz=w400`：
- Google CDN 全球加速
- 完全 bypass GAS quota
- 只要檔案是「任何人有連結可看」就行

### 4. CORS 與 canvas tainted

Drive thumbnail 沒回 CORS header → `<img>` 載入到 canvas 會 tainted → `toBlob()` 失敗。
解法：照片標註功能改走 `serveImage` GAS proxy（同源）→ base64 → dataURL → 載入 canvas 乾淨。

### 5. GAS Web App 的 302 redirect

LINE 的 Verify 一定會看到 302 報錯，因為 `script.google.com/.../exec` 預設 redirect 到 `googleusercontent.com`。
**這個錯誤可以忽略**，實際 webhook 會 follow redirect。
真正會擋住 LINE 的是「具有存取權的使用者」沒選「任何人」。

### 6. 數字型 productId 的隱藏 bug

Sheet 裡的數字會被 JS 解析成 Number 型別 → 跟字串型 productId 比對失敗。
解法：所有 productId 比對都先 `String()` 轉字串。
這個 bug 在 Day 2 連修了 4 次才完全解決。

### 7. Service Worker 版本控制

每次改 SW 行為就要 bump `CACHE_VERSION`，不然舊 cache 會頂一陣子。
用戶第一次重整：SW 偵測新版背景安裝。
第二次重整：新 SW 接管。
加 `skipWaiting()` + `clients.claim()` 可以盡早生效。

### 8. Token 安全與 public repo

寫死 token 進 Code.gs commit 進 public GitHub → 立刻洩漏。
改用 GAS `PropertiesService` 把 token 存在 GAS 內部，code 只讀屬性名 → 完全不進 git。

---

## 📊 最終規模

| 項目 | 數值 |
|---|---|
| 總 commit 數 | 25+ |
| 開發時長 | ~32 天（密集開發 ~2 天）|
| 前端 app.js | ~3000 行 |
| 後端 Code.gs | ~800 行 |
| CSS 樣式 | ~2000 行 |
| 主要功能模組 | 50+ |
| Sheet 分頁 | 4（限樣資料 / 密碼管理 / 登入紀錄 / 變更紀錄）|

---

## 🗺️ 未來可能方向（暫不做）

按使用價值排：

| 想法 | 工程量 | 價值 |
|---|---|---|
| AI 自動描述照片（Gemini Vision） | 中 | ⭐⭐⭐ 60-70% 準確 |
| AI 缺陷自動標 | 大 | ❌ 通用 API 做不到實用級 |
| 限樣 vs 實品差異比對（AI 比對版） | 大 | ⭐⭐⭐⭐ 比缺陷自動標更可行 |
| 手寫便條 OCR | 中 | ⭐⭐⭐⭐ 70-90% 準確 |
| 角色權限分級 | 中 | ⭐⭐⭐⭐ |
| 訂閱通知（追品號被改自動 LINE） | 中 | ⭐⭐⭐ |
| 多語系（中/英/越/印尼） | 中 | ⭐⭐⭐ |
| PWA 推播通知 | 中 | ⭐⭐⭐ |
| 備份匯出 ZIP | 中 | ⭐⭐⭐ |

---

## 🔗 相關資源

- 線上版：https://legstrong77-maker.github.io/limit-sample-system/
- Repo：https://github.com/legstrong77-maker/limit-sample-system
- LINE Bot：富凱限樣機器人（@389zbqva）

---

*本檔案會隨開發持續更新。如有遺漏的重大改動請補上。*
