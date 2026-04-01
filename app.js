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
};

// ============================================================
// 模式切換
// ============================================================

function switchMode(mode) {
  state.mode = mode;

  // 更新 tab 樣式
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });

  // 顯示對應區塊
  document.getElementById('userSection').style.display =
    mode === 'user' ? 'block' : 'none';
  document.getElementById('adminSection').style.display =
    mode === 'admin' ? 'block' : 'none';

  // 如果切換到管理員模式且已登入，刷新列表
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
    renderSearchResults(container, res.results || []);
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

  // 載入圖片
  results.forEach((item) => {
    item.images.forEach((img) => loadImage(img.fileId));
  });
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

  if (!query) {
    renderAdminResults(container, state.allSamples);
    return;
  }

  const filtered = state.allSamples.filter((s) =>
    s.productId.toUpperCase().includes(query)
  );
  renderAdminResults(container, filtered);
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

  container.innerHTML = results.map((item) => renderSampleCard(item, true)).join('');

  // 載入圖片
  results.forEach((item) => {
    item.images.forEach((img) => loadImage(img.fileId));
  });
}

// ============================================================
// 卡片渲染
// ============================================================

function renderSampleCard(item, isAdmin) {
  const imagesHtml = item.images
    .map(
      (img) => `
    <div class="image-item" onclick="openLightbox('${img.fileId}')">
      <img id="img-${img.fileId}" src="" alt="${img.fileName}" style="background: var(--bg-secondary)" />
      <div class="image-overlay">
        <span class="image-name">${escapeHtml(img.fileName)}</span>
      </div>
      ${
        isAdmin
          ? ''
          : ''
      }
    </div>
  `
    )
    .join('');

  const actionsHtml = isAdmin
    ? `
    <div class="card-actions">
      <button class="btn btn-secondary btn-sm" onclick="showEditModal('${escapeHtml(item.productId)}')">✏️ 編輯</button>
      <button class="btn btn-danger btn-sm" onclick="showDeleteConfirm('${escapeHtml(item.productId)}')">🗑️ 刪除</button>
    </div>
  `
    : '';

  const dateStr = item.updatedAt
    ? new Date(item.updatedAt).toLocaleString('zh-TW')
    : '';

  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">
          📦 ${escapeHtml(item.productId)}
          <span class="card-badge">📷 ${item.images.length} 張</span>
        </div>
        ${actionsHtml}
      </div>
      ${item.notes ? `<div class="card-notes">${escapeHtml(item.notes)}</div>` : ''}
      <div class="image-grid">${imagesHtml}</div>
      <div class="card-meta">
        <span>🕐 ${dateStr}</span>
      </div>
    </div>
  `;
}

// ============================================================
// 圖片載入（透過 proxy）
// ============================================================

async function loadImage(fileId) {
  const imgEl = document.getElementById('img-' + fileId);
  if (!imgEl) return;

  // 檢查快取
  if (state.imageCache[fileId]) {
    imgEl.src = state.imageCache[fileId];
    return;
  }

  try {
    const res = await apiGet('getImage', { fileId });
    // res 是 base64 文字
    const text = typeof res === 'string' ? res : await (await fetch(
      `${CONFIG.API_URL}?action=getImage&fileId=${fileId}`
    )).text();

    // 偵測圖片格式
    const dataUrl = `data:image/jpeg;base64,${text}`;
    state.imageCache[fileId] = dataUrl;
    imgEl.src = dataUrl;
  } catch (err) {
    console.error('載入圖片失敗:', fileId, err);
  }
}

// ============================================================
// Lightbox
// ============================================================

function openLightbox(fileId) {
  const overlay = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');

  if (state.imageCache[fileId]) {
    img.src = state.imageCache[fileId];
  } else {
    img.src = '';
    loadImage(fileId).then(() => {
      img.src = state.imageCache[fileId] || '';
    });
  }

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('active');
  document.body.style.overflow = '';
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
      <label class="form-label">照片 *</label>
      <div class="upload-area" id="uploadArea" onclick="document.getElementById('fileInput').click()">
        <div class="upload-icon">📷</div>
        <div class="upload-text">
          點擊上傳照片或<strong>拖曳檔案</strong>到此處
        </div>
        <input type="file" id="fileInput" accept="image/*" multiple onchange="handleFileSelect(event)" />
        <div class="camera-btn-row">
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openCamera()">📸 使用相機拍照</button>
        </div>
      </div>
      <div class="upload-preview-grid" id="uploadPreview"></div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="submitCreate()">確認新增</button>
    </div>
  `);

  setupDragDrop();
}

// ============================================================
// 編輯限樣 Modal
// ============================================================

function showEditModal(productId) {
  const sample = state.allSamples.find((s) => s.productId === productId);
  if (!sample) return;

  state.pendingFiles = [];
  state.editDeletedImageIds = [];

  const existingImagesHtml = sample.images
    .map(
      (img) => `
    <div class="upload-preview-item" id="existing-img-${img.id}">
      <img id="edit-img-${img.fileId}" src="${state.imageCache[img.fileId] || ''}" alt="${img.fileName}" />
      <button class="remove-btn" onclick="markImageForDeletion('${img.id}', '${img.fileId}')">&times;</button>
    </div>
  `
    )
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
      <label class="form-label">現有照片</label>
      <div class="upload-preview-grid" id="existingImages">${existingImagesHtml}</div>
    </div>

    <div class="form-group">
      <label class="form-label">新增照片</label>
      <div class="upload-area" onclick="document.getElementById('editFileInput').click()">
        <div class="upload-icon">📷</div>
        <div class="upload-text">
          點擊上傳或<strong>拖曳檔案</strong>
        </div>
        <input type="file" id="editFileInput" accept="image/*" multiple onchange="handleFileSelect(event)" />
        <div class="camera-btn-row">
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openCamera()">📸 使用相機拍照</button>
        </div>
      </div>
      <div class="upload-preview-grid" id="uploadPreview"></div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="submitEdit('${escapeHtml(sample.productId)}')">確認修改</button>
    </div>
  `);

  // 載入尚未快取的編輯圖片
  sample.images.forEach((img) => {
    if (!state.imageCache[img.fileId]) {
      loadImage(img.fileId).then(() => {
        const el = document.getElementById('edit-img-' + img.fileId);
        if (el) el.src = state.imageCache[img.fileId];
      });
    }
  });

  setupDragDrop();
}

function markImageForDeletion(imageId, fileId) {
  if (!state.editDeletedImageIds) state.editDeletedImageIds = [];
  state.editDeletedImageIds.push(imageId);
  const el = document.getElementById('existing-img-' + imageId);
  if (el) el.remove();
}

// ============================================================
// 刪除確認 Modal
// ============================================================

function showDeleteConfirm(productId) {
  openModal(`
    <div class="confirm-dialog">
      <div class="confirm-icon">⚠️</div>
      <h3>確認刪除限樣？</h3>
      <p>品號：<span class="product-id-highlight">${escapeHtml(productId)}</span></p>
      <p>此操作將刪除所有相關照片，<strong>無法復原</strong>。</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-danger" onclick="submitDelete('${escapeHtml(productId)}')">確認刪除</button>
    </div>
  `);
}

// ============================================================
// 檔案上傳處理
// ============================================================

function handleFileSelect(event) {
  event.stopPropagation();
  const files = Array.from(event.target.files);
  addFiles(files);
}

function setupDragDrop() {
  const uploadArea = document.querySelector('.upload-area');
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
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('image/')
    );
    addFiles(files);
  });
}

function addFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;

    const reader = new FileReader();
    reader.onload = (e) => {
      state.pendingFiles.push({
        fileName: file.name,
        mimeType: file.type,
        dataUrl: e.target.result,
        data: e.target.result.split(',')[1], // base64 without prefix
      });
      renderUploadPreviews();
    };
    reader.readAsDataURL(file);
  }
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
      <img src="${f.dataUrl}" alt="${escapeHtml(f.fileName)}" />
      <button class="remove-btn" onclick="removePendingFile(${i})">&times;</button>
    </div>
  `
    )
    .join('');
}

// ============================================================
// 相機拍照
// ============================================================

function openCamera() {
  openModal(`
    <div class="modal-header">
      <h3 class="modal-title">📸 拍照</h3>
      <button class="modal-close" onclick="stopCamera(); closeModal()">&times;</button>
    </div>
    <div style="position: relative; border-radius: var(--radius-md); overflow: hidden; background: #000;">
      <video id="cameraVideo" autoplay playsinline style="width: 100%; display: block;"></video>
      <canvas id="cameraCanvas" style="display: none;"></canvas>
    </div>
    <div class="modal-footer" style="justify-content: center;">
      <button class="btn btn-primary btn-lg" onclick="capturePhoto()">📷 拍攝</button>
      <button class="btn btn-secondary" onclick="stopCamera(); closeModal()">取消</button>
    </div>
  `);

  startCamera();
}

let cameraStream = null;

async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 4096 },
        height: { ideal: 4096 },
      },
    });
    const video = document.getElementById('cameraVideo');
    if (video) video.srcObject = cameraStream;
  } catch (err) {
    showToast('無法開啟相機：' + err.message, 'error');
    closeModal();
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
}

function capturePhoto() {
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('cameraCanvas');
  if (!video || !canvas) return;

  // 使用原始解析度
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  // 轉成 PNG（無損）
  const dataUrl = canvas.toDataURL('image/png');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `photo_${timestamp}.png`;

  state.pendingFiles.push({
    fileName,
    mimeType: 'image/png',
    dataUrl,
    data: dataUrl.split(',')[1],
  });

  stopCamera();
  closeModal();

  // 重新開啟之前的 modal（新增或編輯）
  // 先渲染預覽
  setTimeout(() => {
    // 如果是新增模式，重新打開新增 modal
    showCreateModal();
  }, 100);
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
    showToast('請至少上傳一張照片', 'error');
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

async function submitEdit(originalProductId) {
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
        data: f.data,
      })),
    });

    if (res.error) throw new Error(res.error);

    showToast('限樣更新成功', 'success');
    closeModal();

    // 清除被刪除圖片的快取
    if (state.editDeletedImageIds) {
      state.editDeletedImageIds.forEach((id) => {
        // find fileId from allSamples
        const sample = state.allSamples.find(
          (s) => s.productId === originalProductId
        );
        if (sample) {
          const img = sample.images.find((i) => i.id === id);
          if (img) delete state.imageCache[img.fileId];
        }
      });
    }

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

async function submitDelete(productId) {
  showLoading(true);
  try {
    const res = await apiPost({
      action: 'delete',
      productId,
    });

    if (res.error) throw new Error(res.error);

    showToast(`已刪除品號 ${productId} 的限樣`, 'success');
    closeModal();

    // 清除快取
    const sample = state.allSamples.find((s) => s.productId === productId);
    if (sample) {
      sample.images.forEach((img) => delete state.imageCache[img.fileId]);
    }

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
