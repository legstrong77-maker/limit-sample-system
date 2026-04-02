// ============================================================
// 限樣系統 - 前端應用邏輯
// ============================================================

// ============================================================
// 全域狀態
// ============================================================
const state = {
  mode: 'user', // 'user' | 'admin'
  isAdminLoggedIn: false,
  adminPassword: '',
  allSamples: [],
  pendingFiles: [], // 新增/編輯時暫存的檔案
  imageCache: {}, // fileId -> base64 data URL cache
  currentEditProductId: null, // 當前編輯的品號（用 state 傳遞，避免 escapeHtml 問題）
  editDeletedImageIds: [],
  // 排序設定
  userSort: { by: 'productId', dir: 'asc' },
  adminSort: { by: 'productId', dir: 'asc' },
};

// ============================================================
// 頁面載入：還原管理員登入狀態（sessionStorage）
// ============================================================
(function restoreAdminSession() {
  const savedPwd = sessionStorage.getItem('adminPassword');
  if (!savedPwd) return;

  // 直接還原狀態，不重新驗證（密碼已在登入時驗過）
  state.isAdminLoggedIn = true;
  state.adminPassword = savedPwd;

  // 如果 DOM 還沒準備好，等 DOMContentLoaded
  function applySession() {
    const loginEl = document.getElementById('adminLogin');
    const panelEl = document.getElementById('adminPanel');
    if (loginEl) loginEl.style.display = 'none';
    if (panelEl) panelEl.style.display = 'block';
    
    // 自動載入名單並切換標籤樣式
    switchMode('admin');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applySession);
  } else {
    applySession();
  }
})();

// ============================================================
// 模式切換
// ============================================================

function switchMode(mode) {
  state.mode = mode;

  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });

  document.getElementById('userSection').style.display =
    mode === 'user' ? 'block' : 'none';
  document.getElementById('adminSection').style.display =
    mode === 'admin' ? 'block' : 'none';

  if (mode === 'admin' && state.isAdminLoggedIn) {
    loadAllSamples();
  }
}

// ============================================================
// 管理員登入/登出
// ============================================================

async function adminLogin() {
  const password = document.getElementById('adminPassword').value;
  if (!password) {
    showToast('請輸入密碼', 'error');
    return;
  }

  showLoading(true);
  try {
    const res = await apiGet('verifyAdmin', { password });
    if (res.success) {
      state.isAdminLoggedIn = true;
      state.adminPassword = password;
      sessionStorage.setItem('adminPassword', password); // 持久化
      document.getElementById('adminLogin').style.display = 'none';
      document.getElementById('adminPanel').style.display = 'block';
      showToast('登入成功', 'success');
      loadAllSamples();
    } else {
      showToast('密碼錯誤', 'error');
    }
  } catch (err) {
    showToast('登入失敗：' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

function adminLogout() {
  state.isAdminLoggedIn = false;
  state.adminPassword = '';
  sessionStorage.removeItem('adminPassword'); // 清除持久化
  document.getElementById('adminLogin').style.display = 'block';
  document.getElementById('adminPanel').style.display = 'none';
  document.getElementById('adminPassword').value = '';
  showToast('已登出', 'info');
}

// ============================================================
// API 通訊
// ============================================================

async function apiGet(action, params = {}) {
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function apiPost(data) {
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ ...data, password: state.adminPassword }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// ============================================================
// 排序工具
// ============================================================

function sortSamples(samples, sortConfig) {
  const { by, dir } = sortConfig;
  return [...samples].sort((a, b) => {
    let valA, valB;
    if (by === 'productId') {
      valA = String(a.productId || '').toUpperCase();
      valB = String(b.productId || '').toUpperCase();
    } else if (by === 'createdAt') {
      valA = new Date(a.createdAt || 0).getTime();
      valB = new Date(b.createdAt || 0).getTime();
    } else {
      valA = a[by] || '';
      valB = b[by] || '';
    }
    if (valA < valB) return dir === 'asc' ? -1 : 1;
    if (valA > valB) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function setUserSort(by) {
  if (state.userSort.by === by) {
    state.userSort.dir = state.userSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.userSort.by = by;
    state.userSort.dir = 'asc';
  }
  updateSortUI('user');
  const query = document.getElementById('searchInput').value.trim();
  if (query) performSearch(query);
}

function setAdminSort(by) {
  if (state.adminSort.by === by) {
    state.adminSort.dir = state.adminSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.adminSort.by = by;
    state.adminSort.dir = 'asc';
  }
  updateSortUI('admin');
  const query = document.getElementById('adminSearchInput').value.trim().toUpperCase();
  const source = query
    ? state.allSamples.filter((s) => String(s.productId || '').toUpperCase().includes(query))
    : state.allSamples;
  const container = document.getElementById('adminResults');
  renderAdminResults(container, source);
}

function updateSortUI(mode) {
  const prefix = mode === 'user' ? 'user' : 'admin';
  const config = mode === 'user' ? state.userSort : state.adminSort;
  ['productId', 'createdAt'].forEach((by) => {
    const btn = document.getElementById(`${prefix}Sort${by === 'productId' ? 'Id' : 'Date'}`);
    if (!btn) return;
    btn.classList.toggle('active', config.by === by);
    btn.querySelector('.sort-arrow').textContent =
      config.by === by ? (config.dir === 'asc' ? '↑' : '↓') : '↕';
  });
}

// ============================================================
// 搜尋（使用者模式）
// ============================================================

let searchTimeout = null;

function handleSearch(event) {
  clearTimeout(searchTimeout);
  const query = event.target.value.trim();

  if (!query) {
    document.getElementById('searchResults').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📦</div>
        <h3>輸入品號開始搜尋</h3>
        <p>在上方搜尋欄輸入品號，即可查看對應的限樣資料</p>
      </div>
    `;
    return;
  }

  searchTimeout = setTimeout(() => performSearch(query), 400);
}

async function performSearch(query) {
  const container = document.getElementById('searchResults');
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner">搜尋中...</div></div>`;

  try {
    const res = await apiGet('search', { productId: query });
    const sorted = sortSamples(res.results || [], state.userSort);
    renderSearchResults(container, sorted);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">❌</div>
        <h3>搜尋失敗</h3>
        <p>${err.message}</p>
      </div>
    `;
  }
}

function renderSearchResults(container, results) {
  if (results.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <h3>找不到符合的限樣</h3>
        <p>請嘗試其他品號</p>
      </div>
    `;
    return;
  }

  container.innerHTML = results.map((item) => renderSampleCard(item, false)).join('');
}

// ============================================================
// 管理員 - 載入所有限樣
// ============================================================

async function loadAllSamples() {
  const container = document.getElementById('adminResults');
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner">載入中...</div></div>`;

  try {
    const res = await apiGet('getAll');
    state.allSamples = res.results || [];
    renderAdminResults(container, state.allSamples);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">❌</div>
        <h3>載入失敗</h3>
        <p>${err.message}</p>
      </div>
    `;
  }
}

function handleAdminSearch(event) {
  const query = event.target.value.trim().toUpperCase();
  const container = document.getElementById('adminResults');

  const source = query
    ? state.allSamples.filter((s) => String(s.productId || '').toUpperCase().includes(query))
    : state.allSamples;

  renderAdminResults(container, source);
}

function renderAdminResults(container, results) {
  if (results.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <h3>尚無限樣資料</h3>
        <p>點擊「新增限樣」開始建立</p>
      </div>
    `;
    return;
  }

  const sorted = sortSamples(results, state.adminSort);
  container.innerHTML = sorted.map((item) => renderSampleCard(item, true)).join('');
}

// ============================================================
// 卡片渲染
// ============================================================

function renderMediaItem(media, isAdmin) {
  const isVideo = media.mediaType === 'video';
  const deleteBtn = isAdmin
    ? '' // 卡片檢視不顯示刪除（在 edit modal 才刪）
    : '';

  if (isVideo) {
    return `
      <div class="image-item" onclick="openLightbox('${media.fileId}', 'video')">
        <video src="https://drive.google.com/uc?export=download&id=${media.fileId}"
               style="width:100%;height:100%;object-fit:cover;pointer-events:none;"
               muted preload="metadata"></video>
        <div class="video-badge">▶</div>
        <div class="image-overlay">
          <span class="image-name">🎥 ${escapeHtml(media.fileName)}</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="image-item" onclick="openLightbox('${media.fileId}', 'image')">
      <img id="img-${media.fileId}" src="https://drive.google.com/thumbnail?id=${media.fileId}&sz=w600" alt="${escapeHtml(media.fileName)}" style="background: var(--bg-secondary)" loading="lazy" />
      <div class="image-overlay">
        <span class="image-name">${escapeHtml(media.fileName)}</span>
      </div>
    </div>
  `;
}

function renderSampleCard(item, isAdmin) {
  const mediaHtml = item.images
    .map((img) => renderMediaItem(img, isAdmin))
    .join('');

  // 用 data-product-id 避免 JS 字串 escaping 問題
  const actionsHtml = isAdmin
    ? `
    <div class="card-actions">
      <button class="btn btn-secondary btn-sm" data-product-id="${escapeHtml(item.productId)}" onclick="showEditModalById(this)">✏️ 編輯</button>
      <button class="btn btn-danger btn-sm" data-product-id="${escapeHtml(item.productId)}" onclick="showDeleteConfirmById(this)">🗑️ 刪除</button>
    </div>
  `
    : '';

  const dateStr = item.updatedAt
    ? new Date(item.updatedAt).toLocaleString('zh-TW')
    : '';

  const videoCount = item.images.filter(m => m.mediaType === 'video').length;
  const imgCount = item.images.length - videoCount;
  let badgeText = '';
  if (imgCount > 0) badgeText += `📷 ${imgCount} 張`;
  if (videoCount > 0) badgeText += `${imgCount > 0 ? ' · ' : ''}🎥 ${videoCount} 支`;

  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">
          📦 ${escapeHtml(item.productId)}
          <span class="card-badge">${badgeText}</span>
        </div>
        ${actionsHtml}
      </div>
      ${item.notes ? `<div class="card-notes">${escapeHtml(item.notes)}</div>` : ''}
      <div class="image-grid">${mediaHtml}</div>
      <div class="card-meta">
        <span>🕐 ${dateStr}</span>
      </div>
    </div>
  `;
}

// 用 element 的 data-product-id 取得品號，避免字串傳遞問題
function showEditModalById(btn) {
  const productId = btn.dataset.productId;
  showEditModal(productId);
}

function showDeleteConfirmById(btn) {
  const productId = btn.dataset.productId;
  showDeleteConfirm(productId);
}

// ============================================================
// Lightbox（支援圖片 + 影片）
// ============================================================

function openLightbox(fileId, type) {
  const overlay = document.getElementById('lightbox');
  const imgEl = document.getElementById('lightboxImg');
  const videoEl = document.getElementById('lightboxVideo');

  if (type === 'video') {
    imgEl.style.display = 'none';
    videoEl.style.display = 'block';
    videoEl.src = `https://drive.google.com/uc?export=download&id=${fileId}`;
    videoEl.controls = true;
    videoEl.play();
  } else {
    videoEl.style.display = 'none';
    videoEl.pause();
    videoEl.src = '';
    imgEl.style.display = 'block';
    imgEl.src = `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`;
  }

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  const overlay = document.getElementById('lightbox');
  const videoEl = document.getElementById('lightboxVideo');
  overlay.classList.remove('active');
  document.body.style.overflow = '';
  videoEl.pause();
  videoEl.src = '';
}

// ESC 鍵關閉 lightbox 和 modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeLightbox();
    closeModal();
  }
});

// ============================================================
// Modal
// ============================================================

function openModal(html) {
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');
  content.innerHTML = html;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const overlay = document.getElementById('modalOverlay');
  overlay.classList.remove('active');
  document.body.style.overflow = '';
  state.pendingFiles = [];
  state.editDeletedImageIds = [];
  state.currentEditProductId = null;
}

// 點擊 overlay 背景關閉
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

// ============================================================
// 新增限樣 Modal
// ============================================================

function showCreateModal() {
  state.pendingFiles = [];

  openModal(`
    <div class="modal-header">
      <h3 class="modal-title">➕ 新增限樣</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>

    <div class="form-group">
      <label class="form-label">品號 *</label>
      <input type="text" class="form-input" id="createProductId" placeholder="請輸入品號" />
    </div>

    <div class="form-group">
      <label class="form-label">注意事項</label>
      <textarea class="form-textarea" id="createNotes" placeholder="輸入品質注意事項..."></textarea>
    </div>

    <div class="form-group">
      <label class="form-label">照片 / 影片 *</label>
      <div class="upload-area" id="uploadArea" onclick="document.getElementById('fileInput').click()">
        <div class="upload-icon">📷</div>
        <div class="upload-text">
          點擊選取照片/影片或<strong>拖曳檔案</strong>到此處
        </div>
        <input type="file" id="fileInput" accept="image/*,video/*" multiple onchange="handleFileSelect(event)" style="display:none;" />
        <input type="file" id="cameraInput" accept="image/*" capture="environment" onchange="handleFileSelect(event)" style="display:none;" />
        <div class="camera-btn-row">
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); document.getElementById('cameraInput').click()">📸 開啟相機拍照</button>
        </div>
      </div>
      <div class="upload-preview-grid" id="uploadPreview"></div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="submitCreate()">確認新增</button>
    </div>
  `);

  setupDragDrop('uploadArea');
}

// ============================================================
// 編輯限樣 Modal
// ============================================================

function showEditModal(productId) {
  const targetId = String(productId || '').trim().toUpperCase();
  const sample = state.allSamples.find(
    (s) => String(s.productId || '').trim().toUpperCase() === targetId
  );

  if (!sample) {
    showToast('找不到該品號的資料', 'error');
    console.error('All samples:', state.allSamples, 'Target:', targetId);
    return;
  }

  state.pendingFiles = [];
  state.editDeletedImageIds = [];
  state.currentEditProductId = productId; // 存在 state，不透過 DOM 字串傳遞

  const existingMediaHtml = sample.images
    .map((media) => {
      const isVideo = media.mediaType === 'video';
      const thumb = isVideo
        ? `<div class="video-preview-thumb"><span>🎥</span><span style="font-size:0.7rem;margin-top:4px">${escapeHtml(media.fileName)}</span></div>`
        : `<img src="https://drive.google.com/thumbnail?id=${media.fileId}&sz=w200" alt="${escapeHtml(media.fileName)}" loading="lazy" />`;
      return `
        <div class="upload-preview-item" id="existing-media-${media.id}">
          ${thumb}
          <button class="remove-btn" onclick="markMediaForDeletion('${media.id}')">&times;</button>
        </div>
      `;
    })
    .join('');

  openModal(`
    <div class="modal-header">
      <h3 class="modal-title">✏️ 編輯限樣</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>

    <div class="form-group">
      <label class="form-label">品號 *</label>
      <input type="text" class="form-input" id="editProductId" value="${escapeHtml(sample.productId)}" />
    </div>

    <div class="form-group">
      <label class="form-label">注意事項</label>
      <textarea class="form-textarea" id="editNotes">${escapeHtml(sample.notes || '')}</textarea>
    </div>

    <div class="form-group">
      <label class="form-label">現有媒體（點 × 刪除）</label>
      <div class="upload-preview-grid" id="existingImages">${existingMediaHtml || '<p style="color:var(--text-muted);font-size:0.85rem">無媒體</p>'}</div>
    </div>

    <div class="form-group">
      <label class="form-label">新增照片 / 影片</label>
      <div class="upload-area" id="editUploadArea" onclick="document.getElementById('editFileInput').click()">
        <div class="upload-icon">📷</div>
        <div class="upload-text">
          點擊選取照片/影片或<strong>拖曳檔案</strong>
        </div>
        <input type="file" id="editFileInput" accept="image/*,video/*" multiple onchange="handleFileSelect(event)" style="display:none;" />
        <input type="file" id="editCameraInput" accept="image/*" capture="environment" onchange="handleFileSelect(event)" style="display:none;" />
        <div class="camera-btn-row">
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); document.getElementById('editCameraInput').click()">📸 開啟相機拍照</button>
        </div>
      </div>
      <div class="upload-preview-grid" id="uploadPreview"></div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="submitEdit()">確認修改</button>
    </div>
  `);

  setupDragDrop('editUploadArea');
}

function markMediaForDeletion(mediaId) {
  if (!state.editDeletedImageIds) state.editDeletedImageIds = [];
  state.editDeletedImageIds.push(mediaId);
  const el = document.getElementById('existing-media-' + mediaId);
  if (el) el.remove();
}

// ============================================================
// 刪除確認 Modal
// ============================================================

function showDeleteConfirm(productId) {
  // 存到 state 避免字串問題
  state.currentDeleteProductId = productId;
  openModal(`
    <div class="confirm-dialog">
      <div class="confirm-icon">⚠️</div>
      <h3>確認刪除限樣？</h3>
      <p>品號：<span class="product-id-highlight">${escapeHtml(productId)}</span></p>
      <p>此操作將刪除所有相關媒體，<strong>無法復原</strong>。</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-danger" onclick="submitDelete()">確認刪除</button>
    </div>
  `);
}

// ============================================================
// 檔案上傳處理（支援圖片 + 影片）
// ============================================================

function handleFileSelect(event) {
  event.stopPropagation();
  const files = Array.from(event.target.files);
  addFiles(files);
  event.target.value = ''; // 允許重複選同一檔案
}

function setupDragDrop(areaId) {
  const uploadArea = document.getElementById(areaId);
  if (!uploadArea) return;

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    addFiles(files);
  });
}

function addFiles(files) {
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        compressImage(e.target.result, file.type, 1280, 0.8, (compressedDataUrl) => {
          state.pendingFiles.push({
            fileName: file.name.replace(/\.[^/.]+$/, '') + '.jpg',
            mimeType: 'image/jpeg',
            mediaType: 'image',
            dataUrl: compressedDataUrl,
            data: compressedDataUrl.split(',')[1],
          });
          renderUploadPreviews();
        });
      };
      reader.readAsDataURL(file);
    } else if (file.type.startsWith('video/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        state.pendingFiles.push({
          fileName: file.name,
          mimeType: file.type,
          mediaType: 'video',
          dataUrl: dataUrl,
          data: dataUrl.split(',')[1],
        });
        renderUploadPreviews();
      };
      reader.readAsDataURL(file);
    }
  }
}

function compressImage(dataUrl, mimeType, maxSize, quality, callback) {
  const img = new Image();
  img.onload = () => {
    let width = img.width;
    let height = img.height;

    if (width > maxSize || height > maxSize) {
      if (width > height) {
        height = Math.round((height *= maxSize / width));
        width = maxSize;
      } else {
        width = Math.round((width *= maxSize / height));
        height = maxSize;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
    callback(compressedDataUrl);
  };
  img.src = dataUrl;
}

function removePendingFile(index) {
  state.pendingFiles.splice(index, 1);
  renderUploadPreviews();
}

function renderUploadPreviews() {
  const container = document.getElementById('uploadPreview');
  if (!container) return;

  container.innerHTML = state.pendingFiles
    .map(
      (f, i) => `
    <div class="upload-preview-item">
      ${
        f.mediaType === 'video'
          ? `<div class="video-preview-thumb"><span>🎥</span><span style="font-size:0.7rem;margin-top:4px">${escapeHtml(f.fileName)}</span></div>`
          : `<img src="${f.dataUrl}" alt="${escapeHtml(f.fileName)}" />`
      }
      <button class="remove-btn" onclick="removePendingFile(${i})">&times;</button>
    </div>
  `
    )
    .join('');
}

// ============================================================
// 提交新增
// ============================================================

async function submitCreate() {
  const productId = document.getElementById('createProductId').value.trim();
  const notes = document.getElementById('createNotes').value.trim();

  if (!productId) {
    showToast('請輸入品號', 'error');
    return;
  }

  if (state.pendingFiles.length === 0) {
    showToast('請至少上傳一張照片或一支影片', 'error');
    return;
  }

  showLoading(true);
  try {
    const res = await apiPost({
      action: 'create',
      productId,
      notes,
      images: state.pendingFiles.map((f) => ({
        fileName: f.fileName,
        mimeType: f.mimeType,
        mediaType: f.mediaType,
        data: f.data,
      })),
    });

    if (res.error) throw new Error(res.error);

    showToast('限樣新增成功', 'success');
    closeModal();
    loadAllSamples();
  } catch (err) {
    showToast('新增失敗：' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ============================================================
// 提交編輯
// ============================================================

async function submitEdit() {
  const originalProductId = state.currentEditProductId;
  if (!originalProductId) {
    showToast('狀態錯誤，請關閉重試', 'error');
    return;
  }

  const productId = document.getElementById('editProductId').value.trim();
  const notes = document.getElementById('editNotes').value.trim();

  if (!productId) {
    showToast('請輸入品號', 'error');
    return;
  }

  showLoading(true);
  try {
    const res = await apiPost({
      action: 'update',
      originalProductId,
      productId,
      notes,
      deletedImageIds: state.editDeletedImageIds || [],
      newImages: state.pendingFiles.map((f) => ({
        fileName: f.fileName,
        mimeType: f.mimeType,
        mediaType: f.mediaType,
        data: f.data,
      })),
    });

    if (res.error) throw new Error(res.error);

    showToast('限樣更新成功', 'success');
    closeModal();
    loadAllSamples();
  } catch (err) {
    showToast('更新失敗：' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ============================================================
// 提交刪除
// ============================================================

async function submitDelete() {
  const productId = state.currentDeleteProductId;
  if (!productId) {
    showToast('狀態錯誤', 'error');
    return;
  }

  showLoading(true);
  try {
    const res = await apiPost({
      action: 'delete',
      productId,
    });

    if (res.error) throw new Error(res.error);

    showToast(`已刪除品號 ${productId} 的限樣`, 'success');
    closeModal();
    loadAllSamples();
  } catch (err) {
    showToast('刪除失敗：' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ============================================================
// Toast 通知
// ============================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || ''}</span> ${escapeHtml(message)}`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================================
// Loading Overlay
// ============================================================

function showLoading(show) {
  document
    .getElementById('loadingOverlay')
    .classList.toggle('active', show);
}

// ============================================================
// 工具函數
// ============================================================

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
