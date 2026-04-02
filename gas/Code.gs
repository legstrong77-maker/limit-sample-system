// ============================================================
// 限樣系統 - Google Apps Script 後端
// ============================================================
// 部署前請設定以下常數：
const SHEET_ID = '1KJaVcsfmpzEFzv9KbFb5QxD31kl1C8kh_apfp8lgssI'; // Google Sheets ID
const DRIVE_FOLDER_ID = '1FbNkbnP3OgFqbRoWgs2C100GwSjbRsdi'; // Google Drive 資料夾 ID
const ADMIN_PASSWORD = 'fk2498505'; // 管理員密碼 (最高權限)
const SHEET_PWD = '密碼管理';
const SHEET_LOG = '登入紀錄';

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
        return jsonResponse(getAllSamples());
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
 * 取得所有限樣
 */
function getAllSamples() {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const results = [];

  for (let i = 1; i < data.length; i++) {
    results.push(rowToObject(headers, data[i]));
  }

  const grouped = groupByProductId(results);
  return { results: grouped };
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
