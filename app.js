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

let dataLoadPromise = null;
let isDataLoaded = false;

// ============================================================
// localStorage 快取 (Stale-While-Revalidate + hash 短路)
// ============================================================
const LS_CACHE_KEY = 'samples_cache_v2';
const LS_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 天
let currentDataHash = null; // 目前持有的 hash，用於背景刷新時帶給 GAS

function loadCachedSamples() {
  try {
    const raw = localStorage.getItem(LS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.data)) return null;
    if (Date.now() - parsed.savedAt > LS_CACHE_MAX_AGE) return null;
    currentDataHash = parsed.hash || null;
    return parsed.data;
  } catch (e) {
    return null;
  }
}

function saveCachedSamples(data, hash) {
  currentDataHash = hash || null;
  try {
    localStorage.setItem(LS_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data, hash: hash || null }));
  } catch (e) {
    // 超過 quota 時清舊的再試一次
    try {
      localStorage.removeItem(LS_CACHE_KEY);
    } catch (_) {}
  }
}

// ============================================================
// 全域資料預載 (大幅提升搜尋與切換速度)
// ============================================================
async function fetchGlobalData(force = false) {
  if (isDataLoaded && !force) return state.allSamples;
  if (!dataLoadPromise || force) {
    const params = {};
    if (currentDataHash && !force) params.hash = currentDataHash;
    if (force) params._force = '1';
    const p = apiGet('getAll', params).then(res => {
      if (res.notModified) {
        // 資料沒變，沿用 state（state 應已被 primeFromCache 餵過）
        isDataLoaded = true;
        if (res.hash) currentDataHash = res.hash;
        return state.allSamples;
      }
      state.allSamples = res.results || [];
      isDataLoaded = true;
      saveCachedSamples(state.allSamples, res.hash);
      return state.allSamples;
    }).finally(() => {
      if (dataLoadPromise === p) dataLoadPromise = null;
    });
    dataLoadPromise = p;
  }
  return dataLoadPromise;
}

// 從 localStorage 同步取得快取（不打 API），讓 UI 瞬間呈現
function primeFromCache() {
  if (state.allSamples.length > 0) return true;
  const cached = loadCachedSamples();
  if (cached && cached.length > 0) {
    state.allSamples = cached;
    isDataLoaded = true;
    return true;
  }
  return false;
}

// 背景靜默更新：不觸發載入畫面，新資料到了再重繪當前畫面
// 帶 hash → 沒變的話 GAS 只回 ~80 bytes，極省流量
async function refreshInBackground() {
  try {
    const params = {};
    if (currentDataHash) params.hash = currentDataHash;
    const res = await apiGet('getAll', params);
    if (res.notModified) {
      // 資料沒變，什麼都不做
      isDataLoaded = true;
      return;
    }
    const next = res.results || [];
    state.allSamples = next;
    isDataLoaded = true;
    saveCachedSamples(next, res.hash);
    rerenderCurrentView();
  } catch (e) {
    // 背景更新失敗就靜默
  }
}

function rerenderCurrentView() {
  if (state.mode === 'admin' && state.isAdminLoggedIn) {
    const container = document.getElementById('adminResults');
    if (!container) return;
    const query = (document.getElementById('adminSearchInput')?.value || '').trim().toUpperCase();
    const source = query ? filterSamples(state.allSamples, query) : state.allSamples;
    renderAdminResults(container, source);
    renderAdminStats();
  } else if (state.mode === 'user') {
    const queryEl = document.getElementById('searchInput');
    const query = (queryEl?.value || '').trim().toUpperCase();
    if (query) {
      const filtered = filterSamples(state.allSamples, query);
      const sorted = sortSamples(filtered, state.userSort);
      renderSearchResults(document.getElementById('searchResults'), sorted);
    } else {
      renderWelcomePanel();
    }
  }
}

function filterSamples(samples, queryUpper) {
  return samples.filter(s =>
    String(s.productId || '').toUpperCase().includes(queryUpper) ||
    String(s.notes || '').toUpperCase().includes(queryUpper)
  );
}

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
    
    const btnPwd = document.getElementById('btnManagePwd');
    if (btnPwd) btnPwd.style.display = (savedPwd === 'fk2498505') ? 'inline-flex' : 'none';
    
    // 自動載入名單並切換標籤樣式
    switchMode('admin');
  }

  // 先用 localStorage 快取餵 state，下面 applySession 就會立刻有資料
  primeFromCache();
  // 背景再去拉最新
  refreshInBackground();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applySession);
  } else {
    applySession();
  }
})();

// 即使非 admin 也預先 prime + 背景 refresh，讓 user 搜尋瞬間有結果
(function primeUserData() {
  if (state.isAdminLoggedIn) return; // admin 路徑已經跑過了
  primeFromCache();
  refreshInBackground();
})();

// 啟動時：渲染歡迎面板 + 處理深連結 + 註冊 service worker
function bootstrapApp() {
  // 深連結優先（會自動切到 user 模式並執行搜尋）
  const handled = applyDeepLink();
  if (!handled && state.mode === 'user') {
    renderWelcomePanel();
  }
  window.addEventListener('hashchange', applyDeepLink);
  // 註冊 service worker（PWA）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapApp);
} else {
  bootstrapApp();
}

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
  } else if (mode === 'user') {
    const query = (document.getElementById('searchInput')?.value || '').trim();
    if (!query) renderWelcomePanel();
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
      
      const btnPwd = document.getElementById('btnManagePwd');
      if (btnPwd) btnPwd.style.display = (password === 'fk2498505') ? 'inline-flex' : 'none';

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

  const btnPwd = document.getElementById('btnManagePwd');
  if (btnPwd) btnPwd.style.display = 'none';

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
  const query = document.getElementById('searchInput').value.trim().toUpperCase();
  if (query && isDataLoaded) {
    const filtered = filterSamples(state.allSamples, query);
    const sorted = sortSamples(filtered, state.userSort);
    renderSearchResults(document.getElementById('searchResults'), sorted);
  }
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
  const source = query ? filterSamples(state.allSamples, query) : state.allSamples;
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
    document.getElementById('searchResults').innerHTML = '';
    renderWelcomePanel();
    return;
  }

  // 一輸入就藏歡迎面板
  const panel = document.getElementById('welcomePanel');
  if (panel) panel.style.display = 'none';

  searchTimeout = setTimeout(() => performSearch(query), 400);
}

async function performSearch(query) {
  const container = document.getElementById('searchResults');
  
  if (!isDataLoaded) {
    container.innerHTML = `<div class="empty-state"><div class="loading-spinner">搜尋中...</div></div>`;
  }

  try {
    const results = await fetchGlobalData();
    const queryUpper = query.toUpperCase();
    const filtered = filterSamples(results, queryUpper);
    const sorted = sortSamples(filtered, state.userSort);
    renderSearchResults(container, sorted);
    // 命中單一品號就推進「最近瀏覽」
    if (sorted.length === 1) pushRecent(sorted[0].productId);
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

async function loadAllSamples(forceRefresh = false) {
  const container = document.getElementById('adminResults');
  
  if (!isDataLoaded || forceRefresh) {
    container.innerHTML = `<div class="empty-state"><div class="loading-spinner">載入中...</div></div>`;
  }

  try {
    const results = await fetchGlobalData(forceRefresh);
    const query = document.getElementById('adminSearchInput').value.trim().toUpperCase();
    const source = query ? filterSamples(results, query) : results;
    renderAdminResults(container, source);
    renderAdminStats();
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

  const source = query ? filterSamples(state.allSamples, query) : state.allSamples;

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

  // Group by Folders (based on 3rd to 7th digit of product ID)
  const folders = {};
  const noFolder = [];

  sorted.forEach(item => {
    const pid = String(item.productId || '').trim();
    if (pid.length >= 7) {
      const folderName = pid.substring(2, 7);
      if (!folders[folderName]) folders[folderName] = [];
      folders[folderName].push(item);
    } else {
      noFolder.push(item);
    }
  });

  let html = '';

  let folderNames = Object.keys(folders);
  const dirMultiplier = state.adminSort.dir === 'asc' ? 1 : -1;
  const isAsc = state.adminSort.dir === 'asc';

  folderNames.sort((a, b) => {
    if (state.adminSort.by === 'productId') {
      if (a < b) return -1 * dirMultiplier;
      if (a > b) return 1 * dirMultiplier;
      return 0;
    } else if (state.adminSort.by === 'createdAt') {
      const timesA = folders[a].map(i => new Date(i.createdAt || 0).getTime());
      const timesB = folders[b].map(i => new Date(i.createdAt || 0).getTime());
      const valA = isAsc ? Math.min(...timesA) : Math.max(...timesA);
      const valB = isAsc ? Math.min(...timesB) : Math.max(...timesB);

      if (valA < valB) return -1 * dirMultiplier;
      if (valA > valB) return 1 * dirMultiplier;
      return 0;
    }
    return 0;
  });
  // lazy render: 只渲染 folder header，內容點開才產生（避免一次塞數百個 <img>）
  state._folderData = state._folderData || {};
  folderNames.forEach(folderName => {
    const items = folders[folderName];
    state._folderData[folderName] = items;
    html += `
      <div class="folder-container">
        <div class="folder-header" onclick="toggleFolder(this)" data-folder="${escapeHtml(folderName)}">
          <span class="folder-icon">📁</span>
          <span class="folder-name">${escapeHtml(folderName)}</span>
          <span class="folder-count">(${items.length})</span>
          <span class="folder-toggle">▼</span>
        </div>
        <div class="folder-content" style="display: none;" data-folder="${escapeHtml(folderName)}" data-rendered="0"></div>
      </div>
    `;
  });

  if (noFolder.length > 0) {
    state._folderData['__other__'] = noFolder;
    html += `
      <div class="folder-container">
        <div class="folder-header" onclick="toggleFolder(this)" data-folder="__other__">
          <span class="folder-icon">📁</span>
          <span class="folder-name">其他</span>
          <span class="folder-count">(${noFolder.length})</span>
          <span class="folder-toggle">▼</span>
        </div>
        <div class="folder-content" style="display: none;" data-folder="__other__" data-rendered="0"></div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// ============================================================
// Admin 統計卡片
// ============================================================
function renderAdminStats() {
  const container = document.getElementById('adminStats');
  if (!container) return;

  const samples = state.allSamples || [];
  const totalProducts = samples.length;
  let totalImages = 0, totalVideos = 0, emptyCount = 0;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let recentCount = 0;

  for (const s of samples) {
    const imgs = s.images || [];
    if (imgs.length === 0) emptyCount++;
    for (const m of imgs) {
      if (m.mediaType === 'video') totalVideos++;
      else totalImages++;
    }
    const t = new Date(s.createdAt || 0).getTime();
    if (t >= sevenDaysAgo) recentCount++;
  }

  container.innerHTML = `
    <div class="stat-card">
      <div class="stat-icon">📦</div>
      <div class="stat-body">
        <div class="stat-value">${totalProducts}</div>
        <div class="stat-label">總品號數</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">🖼️</div>
      <div class="stat-body">
        <div class="stat-value">${totalImages}<span class="stat-sub"> · 🎥 ${totalVideos}</span></div>
        <div class="stat-label">總媒體數</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">✨</div>
      <div class="stat-body">
        <div class="stat-value">${recentCount}</div>
        <div class="stat-label">近 7 天新增</div>
      </div>
    </div>
    ${emptyCount > 0 ? `
    <div class="stat-card stat-warning">
      <div class="stat-icon">⚠️</div>
      <div class="stat-body">
        <div class="stat-value">${emptyCount}</div>
        <div class="stat-label">無媒體品號</div>
      </div>
    </div>` : ''}
  `;
}

function toggleFolder(el) {
  const content = el.nextElementSibling;
  const isHidden = content.style.display === 'none';
  if (isHidden) {
    // 第一次展開才 render 內容
    if (content.dataset.rendered !== '1') {
      const folderName = content.dataset.folder;
      const items = state._folderData?.[folderName] || [];
      content.innerHTML = `<div class="results-grid">${items.map(item => renderSampleCard(item, true)).join('')}</div>`;
      content.dataset.rendered = '1';
    }
    content.style.display = 'block';
  } else {
    content.style.display = 'none';
  }
  el.querySelector('.folder-toggle').textContent = isHidden ? '▲' : '▼';
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
      <img id="img-${media.fileId}" src="https://drive.google.com/thumbnail?id=${media.fileId}&sz=w400" alt="${escapeHtml(media.fileName)}" style="background: var(--bg-secondary)" loading="lazy" decoding="async" />
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

  const pidEsc = escapeHtml(item.productId);

  // admin 才有編輯刪除；user/admin 都有 QR / 列印 / 複製
  const actionsHtml = `
    <div class="card-actions">
      <button class="icon-btn" data-product-id="${pidEsc}" onclick="copyProductId(this)" title="複製品號">📋</button>
      <button class="icon-btn" data-product-id="${pidEsc}" onclick="showQrModal(this)" title="QR Code 分享">🔗</button>
      <button class="icon-btn" data-product-id="${pidEsc}" onclick="printSample(this)" title="列印此限樣">🖨️</button>
      ${isAdmin ? `
      <button class="btn btn-secondary btn-sm" data-product-id="${pidEsc}" onclick="showEditModalById(this)">✏️ 編輯</button>
      <button class="btn btn-danger btn-sm" data-product-id="${pidEsc}" onclick="showDeleteConfirmById(this)">🗑️ 刪除</button>
      ` : ''}
    </div>
  `;

  const dateStr = item.updatedAt
    ? new Date(item.updatedAt).toLocaleString('zh-TW')
    : '';

  const videoCount = item.images.filter(m => m.mediaType === 'video').length;
  const imgCount = item.images.length - videoCount;
  let badgeText = '';
  if (imgCount > 0) badgeText += `📷 ${imgCount} 張`;
  if (videoCount > 0) badgeText += `${imgCount > 0 ? ' · ' : ''}🎥 ${videoCount} 支`;
  if (!badgeText) badgeText = '⚠️ 無媒體';
  const badgeClass = (imgCount + videoCount) === 0 ? 'card-badge card-badge-warn' : 'card-badge';

  // 搜尋高亮（user 模式有 query 時）
  const query = state.mode === 'user'
    ? (document.getElementById('searchInput')?.value || '').trim()
    : '';
  const titleHtml = query ? highlightMatch(item.productId, query) : pidEsc;
  const notesHtml = item.notes
    ? `<div class="card-notes">${query ? highlightMatch(item.notes, query) : escapeHtml(item.notes)}</div>`
    : '';

  return `
    <div class="card" data-product-id="${pidEsc}">
      <div class="card-header">
        <div class="card-title">
          📦 ${titleHtml}
          <span class="${badgeClass}">${badgeText}</span>
        </div>
        ${actionsHtml}
      </div>
      ${notesHtml}
      <div class="image-grid">${mediaHtml}</div>
      <div class="card-meta">
        <span>🕐 ${dateStr}</span>
      </div>
    </div>
  `;
}

// 把 query 在 text 中的 match 包 <mark>
function highlightMatch(text, query) {
  if (!text) return '';
  if (!query) return escapeHtml(text);
  const escapedText = escapeHtml(text);
  const escapedQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return escapedText.replace(new RegExp(escapedQuery, 'gi'), m => `<mark>${m}</mark>`);
  } catch (e) {
    return escapedText;
  }
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

// 鍵盤快捷鍵：ESC 關閉、/ 聚焦搜尋
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeLightbox();
    closeModal();
    return;
  }
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const target = state.mode === 'admin'
      ? document.getElementById('adminSearchInput')
      : document.getElementById('searchInput');
    if (target) {
      e.preventDefault();
      target.focus();
      target.select();
    }
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

    showToast('限樣建立成功', 'success');
    closeModal();
    loadAllSamples(true); // 強制重新抓取以更新 cache
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
    loadAllSamples(true); // 強制更新
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
    loadAllSamples(true);
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
// 複製品號 / QR / 列印 / CSV
// ============================================================

async function copyProductId(btn) {
  const pid = btn.dataset.productId;
  try {
    await navigator.clipboard.writeText(pid);
    showToast(`已複製 ${pid}`, 'success');
  } catch (e) {
    // 回退：建立暫時 textarea
    const ta = document.createElement('textarea');
    ta.value = pid;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast(`已複製 ${pid}`, 'success'); }
    catch (_) { showToast('複製失敗', 'error'); }
    document.body.removeChild(ta);
  }
}

function showQrModal(btn) {
  const pid = btn.dataset.productId;
  const url = location.origin + location.pathname + '#productId=' + encodeURIComponent(pid);

  let qrSvg = '';
  if (typeof qrcode === 'function') {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      qrSvg = qr.createSvgTag({ scalable: true, margin: 2 });
    } catch (e) {
      qrSvg = `<p style="color:var(--danger)">QR 產生失敗：${escapeHtml(e.message)}</p>`;
    }
  } else {
    qrSvg = '<p style="color:var(--text-muted)">QR 產生器尚未載入</p>';
  }

  openModal(`
    <div class="modal-header">
      <h3 class="modal-title">🔗 分享品號</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="qr-container">
      <div class="qr-svg">${qrSvg}</div>
      <p class="qr-pid">📦 ${escapeHtml(pid)}</p>
      <div class="qr-url-row">
        <input type="text" class="form-input" id="qrUrl" value="${escapeHtml(url)}" readonly onclick="this.select()" />
        <button class="btn btn-secondary" onclick="copyQrUrl()">📋 複製連結</button>
      </div>
      <p class="qr-tip">📱 用手機掃描即可直接看到此品號</p>
    </div>
  `);
}

async function copyQrUrl() {
  const input = document.getElementById('qrUrl');
  if (!input) return;
  try {
    await navigator.clipboard.writeText(input.value);
    showToast('連結已複製', 'success');
  } catch (e) {
    input.select();
    document.execCommand('copy');
    showToast('連結已複製', 'success');
  }
}

function printSample(btn) {
  const pid = btn.dataset.productId;
  const sample = state.allSamples.find(s => String(s.productId) === String(pid));
  if (!sample) return showToast('找不到此品號', 'error');

  const printWin = window.open('', '_blank', 'width=900,height=1000');
  const dateStr = sample.updatedAt ? new Date(sample.updatedAt).toLocaleString('zh-TW') : '';
  const imgs = (sample.images || [])
    .filter(m => m.mediaType !== 'video')
    .map(m => `<div class="print-img"><img src="https://drive.google.com/thumbnail?id=${m.fileId}&sz=w1200" alt="${escapeHtml(m.fileName)}" /><div class="print-img-name">${escapeHtml(m.fileName)}</div></div>`)
    .join('');

  printWin.document.write(`<!DOCTYPE html>
<html lang="zh-TW"><head><meta charset="UTF-8"><title>限樣 - ${escapeHtml(pid)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Noto Sans TC',sans-serif;padding:32px;color:#222;line-height:1.6}
  h1{font-size:28px;border-bottom:3px solid #6366f1;padding-bottom:12px;margin-bottom:8px}
  .meta{color:#666;font-size:13px;margin-bottom:20px}
  .notes{background:#f5f5f7;padding:16px;border-radius:8px;margin-bottom:24px;white-space:pre-wrap}
  .notes-label{font-weight:bold;color:#6366f1;margin-bottom:6px}
  .img-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
  .print-img{border:1px solid #ddd;border-radius:8px;overflow:hidden;page-break-inside:avoid}
  .print-img img{width:100%;display:block}
  .print-img-name{padding:8px;font-size:11px;color:#666;background:#fafafa}
  .footer{margin-top:32px;text-align:center;color:#999;font-size:11px}
  @media print{body{padding:16px}@page{margin:1cm}}
</style></head><body>
<h1>📦 ${escapeHtml(pid)}</h1>
<div class="meta">最後更新：${dateStr} ｜ 列印日期：${new Date().toLocaleString('zh-TW')}</div>
${sample.notes ? `<div class="notes"><div class="notes-label">⚠️ 注意事項</div>${escapeHtml(sample.notes)}</div>` : ''}
<div class="img-grid">${imgs || '<p>無照片</p>'}</div>
<div class="footer">限樣系統 ${location.origin}</div>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),500))<\/script>
</body></html>`);
  printWin.document.close();
}

function exportCsv() {
  const samples = state.allSamples || [];
  if (samples.length === 0) return showToast('沒有資料可匯出', 'error');

  const headers = ['品號', '注意事項', '照片數', '影片數', '建立時間', '最後更新'];
  const rows = samples.map(s => {
    const v = (s.images || []).filter(m => m.mediaType === 'video').length;
    const i = (s.images || []).length - v;
    return [
      s.productId || '',
      (s.notes || '').replace(/\n/g, ' '),
      i,
      v,
      s.createdAt ? new Date(s.createdAt).toLocaleString('zh-TW') : '',
      s.updatedAt ? new Date(s.updatedAt).toLocaleString('zh-TW') : '',
    ];
  });

  // BOM for Excel UTF-8 detection
  const csv = '﻿' + [headers, ...rows]
    .map(row => row.map(cell => {
      const s = String(cell);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `限樣資料_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`已匯出 ${samples.length} 筆`, 'success');
}

// ============================================================
// 最近瀏覽（localStorage）
// ============================================================
const LS_RECENT_KEY = 'samples_recent_v1';
const RECENT_MAX = 8;

function getRecent() {
  try {
    return JSON.parse(localStorage.getItem(LS_RECENT_KEY) || '[]');
  } catch (e) { return []; }
}

function pushRecent(productId) {
  if (!productId) return;
  const list = getRecent().filter(p => p !== productId);
  list.unshift(productId);
  try {
    localStorage.setItem(LS_RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch (e) {}
}

// ============================================================
// 歡迎面板（user 模式無搜尋字時顯示）
// ============================================================
function renderWelcomePanel() {
  const panel = document.getElementById('welcomePanel');
  if (!panel) return;

  const samples = state.allSamples || [];
  const total = samples.length;
  let totalMedia = 0;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let recentNew = 0;
  for (const s of samples) {
    totalMedia += (s.images || []).length;
    if (new Date(s.createdAt || 0).getTime() >= sevenDaysAgo) recentNew++;
  }

  const recent = getRecent().filter(pid => samples.some(s => String(s.productId) === pid));
  const recentChips = recent.length
    ? recent.map(pid => `<button class="recent-chip" onclick="searchByPid('${escapeHtml(pid)}')">📦 ${escapeHtml(pid)}</button>`).join('')
    : '<span class="recent-empty">尚無瀏覽紀錄</span>';

  panel.innerHTML = `
    <div class="welcome-hero">
      <div class="welcome-greeting">
        <h2>${getGreeting()}，歡迎使用限樣系統 👋</h2>
        <p>輸入品號開始查詢，或點下方最近瀏覽快速回到品號</p>
      </div>
      <div class="welcome-stats">
        <div class="welcome-stat"><div class="ws-value">${total}</div><div class="ws-label">總品號</div></div>
        <div class="welcome-stat"><div class="ws-value">${totalMedia}</div><div class="ws-label">總媒體</div></div>
        <div class="welcome-stat"><div class="ws-value">${recentNew}</div><div class="ws-label">7 日新增</div></div>
      </div>
    </div>
    <div class="welcome-section">
      <h3>🕒 最近瀏覽</h3>
      <div class="recent-chips">${recentChips}</div>
    </div>
    <div class="welcome-tips">
      <span>💡 小技巧：按 <kbd>/</kbd> 鍵快速聚焦搜尋框；卡片可<strong>列印</strong>、生成 <strong>QR Code</strong>。</span>
    </div>
  `;
  panel.style.display = 'block';
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return '深夜辛苦';
  if (h < 12) return '早安';
  if (h < 18) return '午安';
  return '晚安';
}

function searchByPid(pid) {
  const input = document.getElementById('searchInput');
  if (!input) return;
  input.value = pid;
  performSearch(pid);
  input.focus();
}

// ============================================================
// URL 深連結 (#productId=XX)
// ============================================================
function applyDeepLink() {
  const hash = location.hash || '';
  const m = hash.match(/productId=([^&]+)/);
  if (!m) return false;
  const pid = decodeURIComponent(m[1]);
  if (state.mode !== 'user') switchMode('user');
  setTimeout(() => searchByPid(pid), 100);
  return true;
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

// ============================================================
// 密碼管理 Modal
// ============================================================

async function showPwdManager() {
  openModal(`
    <div class="modal-header">
      <h3 class="modal-title">🔑 密碼管理</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div id="pwdManagerContent">
      <div class="empty-state"><div class="loading-spinner">載入中...</div></div>
    </div>
  `);

  try {
    const res = await apiPost({ action: 'getPasswords' });
    if (res.error) throw new Error(res.error);
    
    let html = `
      <div style="margin-bottom: 20px; display: flex; gap: 8px;">
        <input type="text" id="newPwd" class="form-input" placeholder="新密碼" style="flex: 1;" />
        <input type="text" id="newMemo" class="form-input" placeholder="備註(如: 林xx)" style="flex: 1;" />
        <button class="btn btn-primary" onclick="submitAddPwd()">新增</button>
      </div>
      <table style="width: 100%; text-align: left; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid var(--border-color);">
            <th style="padding: 8px;">密碼</th>
            <th style="padding: 8px;">備註</th>
            <th style="padding: 8px;">操作</th>
          </tr>
        </thead>
        <tbody>
    `;

    if (res.passwords.length === 0) {
      html += `<tr><td colspan="3" style="padding: 16px; text-align: center; color: var(--text-muted);">尚無其他密碼</td></tr>`;
    } else {
      res.passwords.forEach(p => {
        html += `
          <tr style="border-bottom: 1px solid var(--border-color);">
            <td style="padding: 8px;">${escapeHtml(p.pwd)}</td>
            <td style="padding: 8px;">${escapeHtml(p.memo)}</td>
            <td style="padding: 8px;">
              <button class="btn btn-danger btn-sm" onclick="submitDeletePwd('${escapeHtml(p.pwd)}')">刪除</button>
            </td>
          </tr>
        `;
      });
    }

    html += `</tbody></table>`;
    document.getElementById('pwdManagerContent').innerHTML = html;
  } catch (err) {
    document.getElementById('pwdManagerContent').innerHTML = `<p style="color:var(--danger)">載入失敗: ${err.message}</p>`;
  }
}

async function submitAddPwd() {
  const pwd = document.getElementById('newPwd').value.trim();
  const memo = document.getElementById('newMemo').value.trim();
  if (!pwd) return showToast('請輸入密碼', 'error');

  showLoading(true);
  try {
    const res = await apiPost({ action: 'addPassword', newPassword: pwd, memo });
    if (res.error) throw new Error(res.error);
    showToast('新增成功', 'success');
    showPwdManager(); // reload
  } catch(e) {
    showToast('新增失敗: ' + e.message, 'error');
  } finally {
    showLoading(false);
  }
}

async function submitDeletePwd(pwd) {
  if (!confirm(`確定刪除密碼 ${pwd}？`)) return;
  showLoading(true);
  try {
    const res = await apiPost({ action: 'deletePassword', targetPassword: pwd });
    if (res.error) throw new Error(res.error);
    showToast('刪除成功', 'success');
    showPwdManager(); // reload
  } catch(e) {
    showToast('刪除失敗: ' + e.message, 'error');
  } finally {
    showLoading(false);
  }
}
