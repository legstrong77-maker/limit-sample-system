// ============================================================
// 限樣系統 - Google Apps Script 後端
// ============================================================
// 部署前請設定以下常數：
const SHEET_ID = '1KJaVcsfmpzEFzv9KbFb5QxD31kl1C8kh_apfp8lgssI'; // Google Sheets ID
const DRIVE_FOLDER_ID = '1FbNkbnP3OgFqbRoWgs2C100GwSjbRsdi'; // Google Drive 資料夾 ID
const ADMIN_PASSWORD = 'fk2498505'; // 管理員密碼 (最高權限)
const SHEET_PWD = '密碼管理';
const SHEET_LOG = '登入紀錄';

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

  // 更新品號和注意事項（所有同品號的列）
  for (const idx of rowIndices) {
    if (data.productId) {
      sheet.getRange(idx + 1, 2).setValue(data.productId);
    }
    if (data.notes !== undefined) {
      sheet.getRange(idx + 1, 3).setValue(data.notes);
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
    // 加入 mediaType 欄位
    sheet.appendRow([
      'id',
      'productId',
      'notes',
      'imageFileId',
      'imageName',
      'createdAt',
      'updatedAt',
      'mediaType',
    ]);
  }

  return sheet;
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
        images: [],
      };
    }
    map[pid].images.push({
      id: String(row.id),
      fileId: row.imageFileId,
      fileName: row.imageName,
      mediaType: row.mediaType || 'image', // 舊資料向下相容
    });
    // 取最新的 notes 和更新時間
    if (row.updatedAt > map[pid].updatedAt) {
      map[pid].notes = row.notes;
      map[pid].updatedAt = row.updatedAt;
    }
  }

  return Object.values(map);
}

function jsonResponse(data, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ============================================================
// 初始化（首次部署時手動執行一次）
// ============================================================
function initSheet() {
  getSheet();
  Logger.log('Sheet 初始化完成');
}
