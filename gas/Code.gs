// ============================================================
// 限樣系統 - Google Apps Script 後端
// ============================================================
// 部署前請設定以下常數：
const SHEET_ID = '1KJaVcsfmpzEFzv9KbFb5QxD31kl1C8kh_apfp8lgssI'; // Google Sheets ID
const DRIVE_FOLDER_ID = '1FbNkbnP3OgFqbRoWgs2C100GwSjbRsdi'; // Google Drive 資料夾 ID
const ADMIN_PASSWORD = 'fk2498505'; // 管理員密碼 (最高權限)
const SHEET_PWD = '密碼管理';
const SHEET_LOG = '登入紀錄';
const SHEET_AUDIT = '變更紀錄';

// ============================================================
// LINE Bot 設定 (請至 LINE Developers 取得)
// 1. 建立 Messaging API Channel: https://developers.line.biz/console/
// 2. 取得 Channel access token (long-lived) 填入下方
// 3. 把這份 GAS Web App URL 設定為 Webhook URL
// 4. 加 Bot 為好友 → 傳訊息 (品號) → 自動回限樣照片
// ============================================================
const LINE_CHANNEL_TOKEN = ''; // ← 填這裡，例如 'xxxxxxx....'

// 快取設定
const CACHE_KEY_ALL = 'all_samples_v2';
const CACHE_KEY_HASH = 'all_samples_hash_v2';
const CACHE_TTL_SEC = 600; // 10 分鐘

// ============================================================
// 路由處理
// ============================================================

function doGet(e) {
  const action = e.parameter.action;

  try {
    switch (action) {
      case 'search':
        return jsonResponse(searchSamples(e.parameter.productId));
      case 'getAll':
        return jsonResponse(getAllSamples(e.parameter.hash, e.parameter._force));
      case 'getImage':
        return serveImage(e.parameter.fileId);
      case 'verifyAdmin':
        return jsonResponse({
          success: verifyAndLogAdmin(e.parameter.password),
        });
      default:
        return jsonResponse({ error: 'Unknown action' }, 400);
    }
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // === LINE Webhook 路徑 (沒有 password, 但有 events) ===
    if (data.events && Array.isArray(data.events)) {
      handleLineWebhook(data);
      // LINE 期望 200 OK
      return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
    }

    // 管理員操作需要密碼驗證
    if (!verifyAdminLogic(data.password)) {
      return jsonResponse({ error: '密碼錯誤' }, 401);
    }

    switch (data.action) {
      case 'create':
        return jsonResponse(createSample(data));
      case 'update':
        return jsonResponse(updateSample(data));
      case 'delete':
        return jsonResponse(deleteSample(data));
      case 'reorderImages':
        return jsonResponse(reorderImages(data));
      case 'getAuditLog':
        if (data.password !== ADMIN_PASSWORD) return jsonResponse({ error: '權限不足' }, 403);
        return jsonResponse(getAuditLog(data.limit || 200));
      case 'getPasswords':
        if (data.password !== ADMIN_PASSWORD) return jsonResponse({ error: '權限不足' }, 403);
        const pSheet = getPwdSheet();
        const pData = pSheet.getDataRange().getValues();
        const pwds = [];
        for (let i = 1; i < pData.length; i++) {
          pwds.push({ pwd: pData[i][0], memo: pData[i][1] });
        }
        return jsonResponse({ passwords: pwds });
      case 'addPassword':
        if (data.password !== ADMIN_PASSWORD) return jsonResponse({ error: '權限不足' }, 403);
        getPwdSheet().appendRow([data.newPassword, data.memo || '', new Date().toISOString()]);
        return jsonResponse({ success: true });
      case 'deletePassword':
        if (data.password !== ADMIN_PASSWORD) return jsonResponse({ error: '權限不足' }, 403);
        const s = getPwdSheet();
        const sd = s.getDataRange().getValues();
        for (let i = 1; i < sd.length; i++) {
          if (String(sd[i][0]) === String(data.targetPassword)) {
            s.deleteRow(i + 1);
            return jsonResponse({ success: true });
          }
        }
        return jsonResponse({ error: '找不到密碼' });
      default:
        return jsonResponse({ error: 'Unknown action' }, 400);
    }
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ============================================================
// CRUD 操作
// ============================================================

/**
 * 搜尋限樣（依品號，支援模糊搜尋）
 */
function searchSamples(productId) {
  if (!productId) return { results: [] };

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const results = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowProductId = String(row[1]).toUpperCase();
    const searchTerm = String(productId).toUpperCase();

    if (rowProductId.includes(searchTerm)) {
      results.push(rowToObject(headers, row));
    }
  }

  const grouped = groupByProductId(results);
  return { results: grouped };
}

/**
 * 取得所有限樣（10 分鐘快取 + hash 短路）
 *
 * @param {string} clientHash 客戶端目前持有的資料 hash（可選）
 * @param {string} forceFlag  '1' 表示強制重算 cache（debug 用）
 *
 * 流程：
 *   1. 若 forceFlag → 清 cache
 *   2. 拿到當前資料的 hash（cache 內有就直接拿；沒有就讀 sheet 算）
 *   3. 若 clientHash === currentHash → 回 {notModified: true, hash}
 *   4. 否則回完整 {results, hash}
 */
function getAllSamples(clientHash, forceFlag) {
  const cache = CacheService.getScriptCache();

  if (forceFlag === '1') {
    invalidateCache();
  }

  // Hash 跟資料一起算，永遠保證 1:1 對應
  const cachedStr = cache.get(CACHE_KEY_ALL);
  const cachedHash = cache.get(CACHE_KEY_HASH);

  let payloadStr, hash, payload;

  // 不論 payload cache 在不在，只要有 hash 就先試短路
  if (cachedHash && clientHash && clientHash === cachedHash) {
    return { notModified: true, hash: cachedHash };
  }

  if (cachedStr && cachedHash) {
    payloadStr = cachedStr;
    hash = cachedHash;
    try {
      payload = JSON.parse(cachedStr);
    } catch (e) {
      payload = null;
    }
  }

  if (!payload) {
    // Cache miss → 重讀 sheet
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const results = [];
    for (let i = 1; i < data.length; i++) {
      results.push(rowToObject(headers, data[i]));
    }
    const grouped = groupByProductId(results);
    payload = { results: grouped };
    payloadStr = JSON.stringify(payload);
    hash = computeMd5(payloadStr);

    try {
      // hash 很小一定能存
      cache.put(CACHE_KEY_HASH, hash, CACHE_TTL_SEC);
      // 完整資料超過 95KB 就放棄存（CacheService 上限 100KB）
      if (payloadStr.length < 95000) {
        cache.put(CACHE_KEY_ALL, payloadStr, CACHE_TTL_SEC);
      }
    } catch (e) {}

    // 重新算完 hash 後，若 client 帶的 hash 剛好一致 → 短路
    if (clientHash && clientHash === hash) {
      return { notModified: true, hash: hash };
    }
  }

  payload.hash = hash;
  return payload;
}

function invalidateCache() {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove(CACHE_KEY_ALL);
    cache.remove(CACHE_KEY_HASH);
  } catch (e) {}
}

function computeMd5(str) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    str,
    Utilities.Charset.UTF_8
  );
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    let b = bytes[i];
    if (b < 0) b += 256;
    const h = b.toString(16);
    hex += h.length === 1 ? '0' + h : h;
  }
  return hex;
}

/**
 * 新建限樣（支援圖片 + 影片）
 */
function createSample(data) {
  const sheet = getSheet();
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const now = new Date().toISOString();

  const images = data.images || [];
  if (images.length === 0) {
    throw new Error('至少需要一張照片或一支影片');
  }

  for (const img of images) {
    const id = Utilities.getUuid();
    const mediaType = img.mediaType || 'image'; // 'image' | 'video'

    const blob = Utilities.newBlob(
      Utilities.base64Decode(img.data),
      img.mimeType,
      img.fileName
    );
    const file = folder.createFile(blob);
    file.setSharing(
      DriveApp.Access.ANYONE_WITH_LINK,
      DriveApp.Permission.VIEW
    );

    // 欄位: id, productId, notes, imageFileId, imageName, createdAt, updatedAt, mediaType
    const row = [
      id,
      data.productId,
      data.notes || '',
      file.getId(),
      img.fileName,
      now,
      now,
      mediaType,
    ];

    sheet.appendRow(row);
  }

  invalidateCache();
  logAudit(data.password, 'create', data.productId, `新增 ${images.length} 個媒體`);
  return { success: true };
}

/**
 * 更新限樣
 */
function updateSample(data) {
  const sheet = getSheet();
  const allData = sheet.getDataRange().getValues();
  const now = new Date().toISOString();

  const targetProductId = data.originalProductId || data.productId;
  const rowIndices = [];

  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][1]) === String(targetProductId)) {
      rowIndices.push(i);
    }
  }

  if (rowIndices.length === 0) {
    throw new Error('找不到品號: ' + targetProductId);
  }

  // 找到 expiresAt 欄
  const headers = allData[0];
  const expCol = headers.indexOf('expiresAt');

  // 更新品號和注意事項（所有同品號的列）
  for (const idx of rowIndices) {
    if (data.productId) {
      sheet.getRange(idx + 1, 2).setValue(data.productId);
    }
    if (data.notes !== undefined) {
      sheet.getRange(idx + 1, 3).setValue(data.notes);
    }
    if (data.expiresAt !== undefined && expCol !== -1) {
      sheet.getRange(idx + 1, expCol + 1).setValue(data.expiresAt || '');
    }
    sheet.getRange(idx + 1, 7).setValue(now);
  }

  // 處理刪除的媒體
  if (data.deletedImageIds && data.deletedImageIds.length > 0) {
    const deleteIndices = [];
    for (let i = 1; i < allData.length; i++) {
      if (data.deletedImageIds.includes(String(allData[i][0]))) {
        deleteIndices.push(i);
        try {
          DriveApp.getFileById(allData[i][3]).setTrashed(true);
        } catch (e) {
          // 檔案可能已被刪除
        }
      }
    }
    deleteIndices.sort((a, b) => b - a);
    for (const idx of deleteIndices) {
      sheet.deleteRow(idx + 1);
    }
  }

  // 處理新增的媒體
  if (data.newImages && data.newImages.length > 0) {
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    for (const img of data.newImages) {
      const id = Utilities.getUuid();
      const mediaType = img.mediaType || 'image';
      const blob = Utilities.newBlob(
        Utilities.base64Decode(img.data),
        img.mimeType,
        img.fileName
      );
      const file = folder.createFile(blob);
      file.setSharing(
        DriveApp.Access.ANYONE_WITH_LINK,
        DriveApp.Permission.VIEW
      );

      const row = [
        id,
        data.productId || targetProductId,
        data.notes || '',
        file.getId(),
        img.fileName,
        now,
        now,
        mediaType,
      ];
      sheet.appendRow(row);
    }
  }

  invalidateCache();
  const detail = [];
  if (data.productId !== data.originalProductId) detail.push(`改名為 ${data.productId}`);
  if ((data.deletedImageIds || []).length) detail.push(`刪 ${data.deletedImageIds.length} 媒體`);
  if ((data.newImages || []).length) detail.push(`新增 ${data.newImages.length} 媒體`);
  logAudit(data.password, 'update', targetProductId, detail.join(' / ') || '更新注意事項');
  return { success: true };
}

/**
 * 刪除限樣（依品號刪除所有相關記錄）
 */
function deleteSample(data) {
  const sheet = getSheet();
  const allData = sheet.getDataRange().getValues();
  const deleteIndices = [];

  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][1]) === String(data.productId)) {
      deleteIndices.push(i);
      try {
        DriveApp.getFileById(allData[i][3]).setTrashed(true);
      } catch (e) {
        // 檔案可能已被刪除
      }
    }
  }

  if (deleteIndices.length === 0) {
    throw new Error('找不到品號: ' + data.productId);
  }

  deleteIndices.sort((a, b) => b - a);
  for (const idx of deleteIndices) {
    sheet.deleteRow(idx + 1);
  }

  invalidateCache();
  logAudit(data.password, 'delete', data.productId, `刪除 ${deleteIndices.length} 個媒體`);
  return { success: true, deletedCount: deleteIndices.length };
}

// ============================================================
// 圖片 Proxy（舊版相容，現在直接用 Drive thumbnail URL）
// ============================================================

function serveImage(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    return ContentService.createTextOutput(
      Utilities.base64Encode(blob.getBytes())
    ).setMimeType(ContentService.MimeType.TEXT);
  } catch (e) {
    return ContentService.createTextOutput('').setMimeType(
      ContentService.MimeType.TEXT
    );
  }
}

// ============================================================
// 工具函數
// ============================================================

function getSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('限樣資料');

  if (!sheet) {
    sheet = ss.insertSheet('限樣資料');
    sheet.appendRow([
      'id',
      'productId',
      'notes',
      'imageFileId',
      'imageName',
      'createdAt',
      'updatedAt',
      'mediaType',
      'sortOrder',
      'expiresAt',
    ]);
  } else {
    // 自動補欄位（向下相容舊 sheet）
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const ensureCol = name => {
      if (headers.indexOf(name) === -1) {
        sheet.getRange(1, headers.length + 1).setValue(name);
        headers.push(name);
      }
    };
    ensureCol('sortOrder');
    ensureCol('expiresAt');
  }

  return sheet;
}

/**
 * 重新排序某品號內的圖片順序
 * @param {object} data {productId, orderedImageIds: [fileId, fileId, ...]}
 */
function reorderImages(data) {
  const sheet = getSheet();
  const allData = sheet.getDataRange().getValues();
  const headers = allData[0];
  const sortColIdx = headers.indexOf('sortOrder');
  if (sortColIdx === -1) throw new Error('sortOrder 欄位不存在');

  const orderMap = {};
  (data.orderedImageIds || []).forEach((fid, i) => { orderMap[String(fid)] = i; });

  let touched = 0;
  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][1]) === String(data.productId)) {
      const fid = String(allData[i][3]);
      if (orderMap.hasOwnProperty(fid)) {
        sheet.getRange(i + 1, sortColIdx + 1).setValue(orderMap[fid]);
        touched++;
      }
    }
  }

  invalidateCache();
  logAudit(data.password, 'reorder', data.productId, `重排 ${touched} 媒體`);
  return { success: true, touched };
}

function getPwdSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_PWD);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PWD);
    sheet.appendRow(['密碼', '備註', '建立時間']);
  }
  return sheet;
}

function getLogSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_LOG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_LOG);
    sheet.appendRow(['登入時間', '使用密碼']);
  }
  return sheet;
}

function getAuditSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_AUDIT);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_AUDIT);
    sheet.appendRow(['時間', '密碼', '動作', '品號', '詳情']);
  }
  return sheet;
}

function logAudit(password, action, productId, detail) {
  try {
    getAuditSheet().appendRow([
      new Date().toISOString(),
      password || '',
      action || '',
      productId || '',
      detail || '',
    ]);
  } catch (e) {}
}

function getAuditLog(limit) {
  const sheet = getAuditSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { logs: [] };
  const rows = data.slice(1).map(r => ({
    time: r[0],
    password: r[1],
    action: r[2],
    productId: r[3],
    detail: r[4],
  }));
  // 倒序：最近的在前面
  rows.reverse();
  return { logs: rows.slice(0, limit) };
}

function verifyAdminLogic(password) {
  if (String(password) === String(ADMIN_PASSWORD)) return true;
  const sheet = getPwdSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(password)) return true;
  }
  return false;
}

function verifyAndLogAdmin(password) {
  const isValid = verifyAdminLogic(password);
  if (isValid) {
    const logSheet = getLogSheet();
    logSheet.appendRow([new Date().toISOString(), password]);
  }
  return isValid;
}

function rowToObject(headers, row) {
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    obj[headers[i]] = row[i];
  }
  return obj;
}

function groupByProductId(rows) {
  const map = {};

  for (const row of rows) {
    const pid = row.productId;
    if (!map[pid]) {
      map[pid] = {
        productId: pid,
        notes: row.notes,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        expiresAt: row.expiresAt || '',
        images: [],
      };
    }
    // 任何 row 有 expiresAt 就用那個
    if (row.expiresAt && !map[pid].expiresAt) {
      map[pid].expiresAt = row.expiresAt;
    }
    const sortRaw = row.sortOrder;
    const sortNum = (sortRaw === '' || sortRaw == null) ? Number.MAX_SAFE_INTEGER : Number(sortRaw);
    map[pid].images.push({
      id: String(row.id),
      fileId: row.imageFileId,
      fileName: row.imageName,
      mediaType: row.mediaType || 'image',
      _sort: sortNum,
      _created: row.createdAt,
    });
    if (row.updatedAt > map[pid].updatedAt) {
      map[pid].notes = row.notes;
      map[pid].updatedAt = row.updatedAt;
    }
  }

  // 依 sortOrder 排序圖片，未設定的依建立時間排在後面
  for (const pid in map) {
    map[pid].images.sort((a, b) => {
      if (a._sort !== b._sort) return a._sort - b._sort;
      return String(a._created).localeCompare(String(b._created));
    });
    map[pid].images.forEach(im => { delete im._sort; delete im._created; });
  }

  return Object.values(map);
}

function jsonResponse(data, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ============================================================
// LINE Bot Webhook 處理
// ============================================================

function handleLineWebhook(payload) {
  if (!LINE_CHANNEL_TOKEN) {
    Logger.log('LINE_CHANNEL_TOKEN 未設定，略過');
    return;
  }
  for (const ev of payload.events) {
    try {
      if (ev.type !== 'message' || ev.message.type !== 'text') continue;
      const query = String(ev.message.text || '').trim();
      if (!query) continue;
      handleLineQuery(ev.replyToken, query);
    } catch (e) {
      Logger.log('LINE event 處理錯誤: ' + e.message);
    }
  }
}

function handleLineQuery(replyToken, query) {
  // 找品號 (模糊比對, 取第一個命中)
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const upperQuery = query.toUpperCase();

  // 收集所有 row
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    rows.push(rowToObject(headers, data[i]));
  }
  const grouped = groupByProductId(rows);

  // 完全相符優先；其次 includes
  let match = grouped.find(s => String(s.productId).toUpperCase() === upperQuery);
  if (!match) {
    const candidates = grouped.filter(s => String(s.productId).toUpperCase().includes(upperQuery));
    if (candidates.length === 0) {
      lineReply(replyToken, [{
        type: 'text',
        text: `❌ 找不到品號「${query}」\n\n💡 可輸入完整或部分品號搜尋`
      }]);
      return;
    }
    if (candidates.length > 1) {
      // 多個 → 列出讓使用者選
      const list = candidates.slice(0, 8).map(s => `📦 ${s.productId}`).join('\n');
      const more = candidates.length > 8 ? `\n\n…還有 ${candidates.length - 8} 個` : '';
      lineReply(replyToken, [{
        type: 'text',
        text: `🔍 找到 ${candidates.length} 個符合：\n\n${list}${more}\n\n請輸入更完整的品號`
      }]);
      return;
    }
    match = candidates[0];
  }

  // 有 match → 回 文字 + 圖片 (前 4 張, LINE reply 上限 5 訊息)
  const cleanNotes = (match.notes || '').replace(/#([^\s#,]+)/g, '').replace(/\s+/g, ' ').trim();
  const tagsArr = [];
  let m;
  const re = /#([^\s#,]+)/g;
  while ((m = re.exec(match.notes || '')) !== null) tagsArr.push(m[1]);

  const expiry = match.expiresAt ? `\n⏰ 到期: ${String(match.expiresAt).slice(0,10)}` : '';
  const tagStr = tagsArr.length ? `\n🏷️ ${tagsArr.map(t => '#' + t).join(' ')}` : '';

  const messages = [{
    type: 'text',
    text: `📦 ${match.productId}${tagStr}${expiry}\n\n${cleanNotes || '（無注意事項）'}`,
  }];

  const photos = (match.images || []).filter(im => im.mediaType !== 'video').slice(0, 4);
  for (const p of photos) {
    messages.push({
      type: 'image',
      originalContentUrl: `https://drive.google.com/thumbnail?id=${p.fileId}&sz=w1024`,
      previewImageUrl: `https://drive.google.com/thumbnail?id=${p.fileId}&sz=w240`,
    });
  }

  lineReply(replyToken, messages);
}

function lineReply(replyToken, messages) {
  if (!LINE_CHANNEL_TOKEN) return;
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + LINE_CHANNEL_TOKEN },
      payload: JSON.stringify({ replyToken, messages }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log('LINE reply 失敗: ' + e.message);
  }
}

// ============================================================
// 初始化（首次部署時手動執行一次）
// ============================================================
function initSheet() {
  getSheet();
  Logger.log('Sheet 初始化完成');
}
