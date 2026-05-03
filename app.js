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
  // #tag 篩選：精準對應 tag 名稱
  if (queryUpper.startsWith('#')) {
    const tag = queryUpper.slice(1);
    if (!tag) return samples;
    return samples.filter(s =>
      extractTags(s.notes).some(t => t.toUpperCase() === tag)
    );
  }
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
    
    const isMaster = savedPwd === 'fk2498505';
    const btnPwd = document.getElementById('btnManagePwd');
    if (btnPwd) btnPwd.style.display = isMaster ? 'inline-flex' : 'none';
    const btnAudit = document.getElementById('btnAuditLog');
    if (btnAudit) btnAudit.style.display = isMaster ? 'inline-flex' : 'none';

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
    navigator.serviceWorker.register('sw.js').then(() => {
      // SW 就緒後背景預熱所有 thumbnail
      schedulePrewarmThumbnails();
    }).catch(() => {});
  }
  // 離線狀態
  setupOfflineBanner();
}

// ============================================================
// 離線狀態指示
// ============================================================
function setupOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;
  const update = () => {
    if (navigator.onLine) {
      banner.classList.remove('visible');
    } else {
      banner.classList.add('visible');
    }
  };
  window.addEventListener('online', () => {
    update();
    showToast('已恢復連線', 'success');
    refreshInBackground();
  });
  window.addEventListener('offline', () => {
    update();
    showToast('已切換到離線模式', 'info');
  });
  update();
}

// ============================================================
// 背景預熱 thumbnail (寫入 SW cache，之後完全離線)
// ============================================================
let prewarmDone = false;
function schedulePrewarmThumbnails() {
  if (prewarmDone) return;
  const run = () => {
    if (prewarmDone) return;
    prewarmDone = true;
    prewarmThumbnails();
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(run, { timeout: 5000 });
  } else {
    setTimeout(run, 3000);
  }
}

async function prewarmThumbnails() {
  const samples = state.allSamples || [];
  if (samples.length === 0) return;

  const urls = [];
  for (const s of samples) {
    for (const m of (s.images || [])) {
      if (m.mediaType !== 'video' && m.fileId) {
        urls.push(`https://drive.google.com/thumbnail?id=${m.fileId}&sz=w400`);
      }
    }
  }
  if (urls.length === 0) return;

  // 並行 6 條，避免一次塞爆網路；用 Image() 自動走 SW cache
  let inFlight = 0;
  let idx = 0;
  let done = 0;
  await new Promise(resolve => {
    const next = () => {
      while (inFlight < 6 && idx < urls.length) {
        const u = urls[idx++];
        inFlight++;
        const img = new Image();
        const finish = () => {
          inFlight--;
          done++;
          if (done >= urls.length) resolve();
          else next();
        };
        img.onload = finish;
        img.onerror = finish;
        img.src = u;
      }
    };
    next();
  });
  console.log(`[prewarm] ${urls.length} thumbnails cached`);
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
      
      const isMaster = password === 'fk2498505';
      const btnPwd = document.getElementById('btnManagePwd');
      if (btnPwd) btnPwd.style.display = isMaster ? 'inline-flex' : 'none';
      const btnAudit = document.getElementById('btnAuditLog');
      if (btnAudit) btnAudit.style.display = isMaster ? 'inline-flex' : 'none';

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
  const btnAudit = document.getElementById('btnAuditLog');
  if (btnAudit) btnAudit.style.display = 'none';

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
    // 命中單一品號就推進「最近瀏覽」 + 記錄查詢統計
    if (sorted.length === 1) {
      pushRecent(sorted[0].productId);
      recordHit(sorted[0].productId);
    }
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

  // admin 才有編輯刪除 + 多選 checkbox；user/admin 都有 QR / 列印 / 複製
  const checkboxHtml = isAdmin ? `
    <label class="card-select" onclick="event.stopPropagation()">
      <input type="checkbox" class="card-select-checkbox" data-product-id="${pidEsc}" onchange="onCardSelectChange(this)" />
      <span></span>
    </label>
  ` : '';

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

  // 標籤從 notes 解析；本文則去掉 #tag 部分顯示
  const tags = extractTags(item.notes);
  const cleanNotes = notesWithoutTags(item.notes);
  const notesHtml = cleanNotes
    ? `<div class="card-notes">${query ? highlightMatch(cleanNotes, query) : escapeHtml(cleanNotes)}</div>`
    : '';
  const tagsHtml = renderTagsHtml(tags);

  return `
    <div class="card" data-product-id="${pidEsc}">
      <div class="card-header">
        <div class="card-title">
          ${checkboxHtml}
          📦 ${titleHtml}
          <span class="${badgeClass}">${badgeText}</span>
        </div>
        ${actionsHtml}
      </div>
      ${tagsHtml}
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
  const annBtn = document.getElementById('lightboxAnnotateBtn');

  state.currentLightboxFileId = fileId;
  state.currentLightboxType = type;

  // 找出此 fileId 對應的 productId（給標註後上傳用）
  state.currentLightboxProductId = null;
  for (const s of state.allSamples) {
    if ((s.images || []).some(m => m.fileId === fileId)) {
      state.currentLightboxProductId = s.productId;
      break;
    }
  }

  if (type === 'video') {
    imgEl.style.display = 'none';
    videoEl.style.display = 'block';
    videoEl.src = `https://drive.google.com/uc?export=download&id=${fileId}`;
    videoEl.controls = true;
    videoEl.play();
    if (annBtn) annBtn.style.display = 'none';
  } else {
    videoEl.style.display = 'none';
    videoEl.pause();
    videoEl.src = '';
    imgEl.style.display = 'block';
    imgEl.src = `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`;
    // 只有 admin 登入且有 productId 才顯示標註按鈕
    if (annBtn) annBtn.style.display = (state.isAdminLoggedIn && state.currentLightboxProductId) ? 'flex' : 'none';
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
    .map((media, idx) => {
      const isVideo = media.mediaType === 'video';
      const thumb = isVideo
        ? `<div class="video-preview-thumb"><span>🎥</span><span style="font-size:0.7rem;margin-top:4px">${escapeHtml(media.fileName)}</span></div>`
        : `<img src="https://drive.google.com/thumbnail?id=${media.fileId}&sz=w200" alt="${escapeHtml(media.fileName)}" loading="lazy" />`;
      return `
        <div class="upload-preview-item draggable" id="existing-media-${media.id}"
             draggable="true" data-file-id="${escapeHtml(media.fileId)}" data-media-id="${escapeHtml(media.id)}"
             ondragstart="onMediaDragStart(event)" ondragover="onMediaDragOver(event)"
             ondrop="onMediaDrop(event)" ondragend="onMediaDragEnd(event)">
          <div class="drag-handle" title="拖曳調整順序">⋮⋮</div>
          ${idx === 0 ? '<div class="cover-badge">封面</div>' : ''}
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
  state.currentDeleteProductId = productId;
  const sample = state.allSamples.find(s => String(s.productId) === String(productId));
  const mediaCount = sample ? (sample.images || []).length : 0;

  openModal(`
    <div class="confirm-dialog">
      <div class="confirm-icon">⚠️</div>
      <h3>確認刪除限樣？</h3>
      <p>品號：<span class="product-id-highlight">${escapeHtml(productId)}</span></p>
      <p>將刪除 <strong>${mediaCount}</strong> 個媒體檔案，<strong>無法復原</strong>。</p>
      <div class="confirm-input-group">
        <label class="form-label">請輸入品號 <code>${escapeHtml(productId)}</code> 確認：</label>
        <input type="text" class="form-input" id="deleteConfirmInput" placeholder="輸入品號…"
               oninput="onDeleteConfirmInput(this)" autocomplete="off" />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-danger" id="btnConfirmDelete" disabled onclick="submitDelete()">確認刪除</button>
    </div>
  `);
  setTimeout(() => document.getElementById('deleteConfirmInput')?.focus(), 100);
}

function onDeleteConfirmInput(input) {
  const target = String(state.currentDeleteProductId).trim();
  const ok = input.value.trim().toUpperCase() === target.toUpperCase();
  const btn = document.getElementById('btnConfirmDelete');
  if (btn) btn.disabled = !ok;
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

  // 重複品號偵測
  const existing = state.allSamples.find(
    (s) => String(s.productId).toUpperCase() === productId.toUpperCase()
  );
  if (existing) {
    showDuplicateModal(existing, productId, notes);
    return;
  }

  await doCreateSample(productId, notes);
}

async function doCreateSample(productId, notes) {
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
    loadAllSamples(true);
  } catch (err) {
    showToast('新增失敗：' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

async function doMergeIntoExisting(originalProductId, productId, notes) {
  showLoading(true);
  try {
    const res = await apiPost({
      action: 'update',
      originalProductId,
      productId,
      notes,
      deletedImageIds: [],
      newImages: state.pendingFiles.map((f) => ({
        fileName: f.fileName,
        mimeType: f.mimeType,
        mediaType: f.mediaType,
        data: f.data,
      })),
    });

    if (res.error) throw new Error(res.error);

    showToast(`已併入既有品號 ${productId}`, 'success');
    closeModal();
    loadAllSamples(true);
  } catch (err) {
    showToast('併入失敗：' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

function showDuplicateModal(existing, productId, notes) {
  const existingMediaCount = (existing.images || []).length;
  const newMediaCount = state.pendingFiles.length;

  // 開新 modal 但保留 pendingFiles，因為使用者可能會選「合併」
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');

  // 暫存目前的 pendingFiles（防止 closeModal 清掉）
  const savedFiles = [...state.pendingFiles];

  content.innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title">⚠️ 品號已存在</h3>
    </div>
    <div class="dup-warning">
      <div class="dup-pid">📦 ${escapeHtml(productId)}</div>
      <p>系統內已有此品號（${existingMediaCount} 張媒體），你現在要新增 ${newMediaCount} 張。</p>
      <p class="dup-question">要怎麼處理？</p>
    </div>
    <div class="dup-actions">
      <button class="dup-option dup-merge" onclick="window.__dupMerge()">
        <div class="dup-icon">🔗</div>
        <div class="dup-text">
          <strong>併入既有品號</strong>
          <span>新照片加到既有的 ${existingMediaCount} 張後面（推薦）</span>
        </div>
      </button>
      <button class="dup-option dup-new" onclick="window.__dupNew()">
        <div class="dup-icon">➕</div>
        <div class="dup-text">
          <strong>仍要新建一筆</strong>
          <span>會出現兩筆同品號，可能造成混亂</span>
        </div>
      </button>
      <button class="dup-option dup-cancel" onclick="window.__dupCancel()">
        <div class="dup-icon">✖️</div>
        <div class="dup-text">
          <strong>取消</strong>
          <span>回到新增表單，我手動改品號</span>
        </div>
      </button>
    </div>
  `;

  // 註冊一次性處理器
  window.__dupMerge = () => {
    state.pendingFiles = savedFiles;
    doMergeIntoExisting(existing.productId, productId, notes);
  };
  window.__dupNew = () => {
    state.pendingFiles = savedFiles;
    doCreateSample(productId, notes);
  };
  window.__dupCancel = () => {
    state.pendingFiles = savedFiles;
    showCreateModal();
    // 還原表單欄位（showCreateModal 重建了 modal）
    setTimeout(() => {
      const pidEl = document.getElementById('createProductId');
      const notesEl = document.getElementById('createNotes');
      if (pidEl) pidEl.value = productId;
      if (notesEl) notesEl.value = notes;
      renderUploadPreviews();
    }, 50);
  };
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

  // 拖曳順序變動 → 收集新順序
  const reorderedFileIds = dragReordered ? getCurrentImageOrder() : null;

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

    // 排序變動 → 額外送 reorderImages
    if (reorderedFileIds && reorderedFileIds.length > 0) {
      try {
        await apiPost({
          action: 'reorderImages',
          productId: productId || originalProductId,
          orderedImageIds: reorderedFileIds,
        });
      } catch (e) {
        showToast('排序儲存失敗：' + e.message, 'error');
      }
    }

    showToast('限樣更新成功', 'success');
    dragReordered = false;
    closeModal();
    loadAllSamples(true);
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
// 拖曳排序（編輯時的現有媒體）
// ============================================================
let dragSrcEl = null;
let dragReordered = false;

function onMediaDragStart(e) {
  dragSrcEl = e.currentTarget;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', e.currentTarget.dataset.mediaId);
}

function onMediaDragOver(e) {
  e.preventDefault();
  const target = e.currentTarget;
  if (!dragSrcEl || target === dragSrcEl) return;
  const container = target.parentElement;
  const rect = target.getBoundingClientRect();
  const after = (e.clientX - rect.left) > rect.width / 2;
  if (after) container.insertBefore(dragSrcEl, target.nextSibling);
  else container.insertBefore(dragSrcEl, target);
  dragReordered = true;
}

function onMediaDrop(e) {
  e.preventDefault();
}

function onMediaDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  dragSrcEl = null;
  // 更新 cover badge 位置
  const items = document.querySelectorAll('#existingImages .draggable');
  items.forEach((el, i) => {
    el.querySelectorAll('.cover-badge').forEach(b => b.remove());
    if (i === 0) {
      const badge = document.createElement('div');
      badge.className = 'cover-badge';
      badge.textContent = '封面';
      el.insertBefore(badge, el.querySelector('.drag-handle')?.nextSibling || el.firstChild);
    }
  });
}

// 取得目前 edit modal 中的圖片新順序（fileId 陣列）
function getCurrentImageOrder() {
  return Array.from(document.querySelectorAll('#existingImages .draggable'))
    .map(el => el.dataset.fileId);
}

// ============================================================
// 變更歷史 (Audit Log)
// ============================================================
async function showAuditLog() {
  if (state.adminPassword !== 'fk2498505') {
    showToast('需要最高權限密碼', 'error');
    return;
  }
  openModal(`
    <div class="modal-header">
      <h3 class="modal-title">📜 變更紀錄</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div id="auditLogContent">
      <div class="empty-state"><div class="loading-spinner">載入中...</div></div>
    </div>
  `);
  try {
    const res = await apiPost({ action: 'getAuditLog', limit: 300 });
    if (res.error) throw new Error(res.error);
    const logs = res.logs || [];

    const actionEmoji = { create: '➕', update: '✏️', delete: '🗑️', reorder: '🔀' };
    const actionLabel = { create: '新增', update: '修改', delete: '刪除', reorder: '排序' };

    let html = '';
    if (logs.length === 0) {
      html = '<div class="empty-state"><p>尚無變更紀錄</p></div>';
    } else {
      html = `
        <div class="audit-search">
          <input type="text" class="form-input" placeholder="篩選品號/動作/密碼…"
                 oninput="filterAuditLog(this.value)" />
        </div>
        <table class="audit-table" id="auditTable">
          <thead><tr><th>時間</th><th>動作</th><th>品號</th><th>詳情</th><th>密碼</th></tr></thead>
          <tbody>
            ${logs.map(l => `
              <tr>
                <td class="audit-time">${escapeHtml(new Date(l.time).toLocaleString('zh-TW'))}</td>
                <td><span class="audit-action audit-action-${escapeHtml(l.action)}">${actionEmoji[l.action] || ''} ${actionLabel[l.action] || escapeHtml(l.action)}</span></td>
                <td><strong>${escapeHtml(l.productId)}</strong></td>
                <td>${escapeHtml(l.detail)}</td>
                <td class="audit-pwd">${escapeHtml(l.password)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <p class="audit-note">顯示最近 ${logs.length} 筆</p>
      `;
    }
    document.getElementById('auditLogContent').innerHTML = html;
  } catch (err) {
    document.getElementById('auditLogContent').innerHTML = `<p style="color:var(--danger)">載入失敗: ${escapeHtml(err.message)}</p>`;
  }
}

function filterAuditLog(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('#auditTable tbody tr').forEach(tr => {
    tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

// ============================================================
// 條碼掃描 (BarcodeDetector API)
// ============================================================
let scanStream = null;
let scanLoopActive = false;

async function openBarcodeScanner(targetInputId) {
  if (!('BarcodeDetector' in window)) {
    showToast('此瀏覽器不支援掃描，請改用 Chrome 行動版', 'error');
    return;
  }
  state.scanTargetInput = targetInputId;
  openModal(`
    <div class="modal-header">
      <h3 class="modal-title">📷 掃描條碼 / QR</h3>
      <button class="modal-close" onclick="closeBarcodeScanner()">&times;</button>
    </div>
    <div class="scan-stage">
      <video id="scanVideo" autoplay playsinline muted></video>
      <div class="scan-frame"></div>
      <div class="scan-line"></div>
    </div>
    <div class="scan-result" id="scanResult">對準條碼…</div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeBarcodeScanner()">取消</button>
    </div>
  `);

  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }
    });
    const video = document.getElementById('scanVideo');
    video.srcObject = scanStream;
    await video.play();

    const detector = new BarcodeDetector({
      formats: ['code_128', 'code_39', 'code_93', 'codabar', 'ean_13', 'ean_8', 'itf', 'qr_code', 'upc_a', 'upc_e', 'data_matrix']
    });
    scanLoopActive = true;
    scanLoop(video, detector);
  } catch (err) {
    showToast('無法啟動相機：' + err.message, 'error');
    closeBarcodeScanner();
  }
}

async function scanLoop(video, detector) {
  while (scanLoopActive) {
    try {
      const codes = await detector.detect(video);
      if (codes && codes.length > 0) {
        const value = codes[0].rawValue;
        // 振動回饋
        if ('vibrate' in navigator) navigator.vibrate(80);
        document.getElementById('scanResult').textContent = '✅ 掃到：' + value;
        // QR 內若是分享連結，抽取 productId
        let resolved = value;
        const m = value.match(/productId=([^&]+)/);
        if (m) resolved = decodeURIComponent(m[1]);

        // 填入目標輸入框
        const target = document.getElementById(state.scanTargetInput);
        if (target) {
          target.value = resolved;
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        }
        await new Promise(r => setTimeout(r, 600));
        closeBarcodeScanner();
        return;
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
}

function closeBarcodeScanner() {
  scanLoopActive = false;
  if (scanStream) {
    scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }
  closeModal();
}

// ============================================================
// 多選 + 批次操作
// ============================================================
state.selectedPids = new Set();

function onCardSelectChange(cb) {
  const pid = cb.dataset.productId;
  if (cb.checked) state.selectedPids.add(pid);
  else state.selectedPids.delete(pid);
  updateBatchToolbar();
}

function updateBatchToolbar() {
  const bar = document.getElementById('batchToolbar');
  if (!bar) return;
  const n = state.selectedPids.size;
  if (n === 0) {
    bar.classList.remove('visible');
  } else {
    bar.classList.add('visible');
    document.getElementById('batchCount').textContent = n;
  }
}

function selectAllVisible() {
  document.querySelectorAll('#adminResults .card-select-checkbox').forEach(cb => {
    cb.checked = true;
    state.selectedPids.add(cb.dataset.productId);
  });
  updateBatchToolbar();
}

function clearSelection() {
  document.querySelectorAll('#adminResults .card-select-checkbox').forEach(cb => {
    cb.checked = false;
  });
  state.selectedPids.clear();
  updateBatchToolbar();
}

function batchPrint() {
  const pids = Array.from(state.selectedPids);
  if (pids.length === 0) return;
  const samples = pids
    .map(pid => state.allSamples.find(s => String(s.productId) === pid))
    .filter(Boolean);
  if (samples.length === 0) return showToast('找不到資料', 'error');

  const win = window.open('', '_blank', 'width=900,height=1000');
  const sectionsHtml = samples.map(sample => {
    const dateStr = sample.updatedAt ? new Date(sample.updatedAt).toLocaleString('zh-TW') : '';
    const imgs = (sample.images || [])
      .filter(m => m.mediaType !== 'video')
      .map(m => `<div class="print-img"><img src="https://drive.google.com/thumbnail?id=${m.fileId}&sz=w1200" alt=""/></div>`)
      .join('');
    const tags = extractTags(sample.notes);
    const cleanNotes = notesWithoutTags(sample.notes);
    return `
      <section class="print-section">
        <h1>📦 ${escapeHtml(sample.productId)}</h1>
        <div class="meta">最後更新：${dateStr}</div>
        ${tags.length ? `<div class="tags">${tags.map(t => `<span>#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        ${cleanNotes ? `<div class="notes"><div class="notes-label">⚠️ 注意事項</div>${escapeHtml(cleanNotes)}</div>` : ''}
        <div class="img-grid">${imgs || '<p>無照片</p>'}</div>
      </section>
    `;
  }).join('');

  win.document.write(`<!DOCTYPE html>
<html lang="zh-TW"><head><meta charset="UTF-8"><title>批次列印 (${samples.length})</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Noto Sans TC',sans-serif;color:#222;line-height:1.6}
  .print-section{padding:32px;page-break-after:always}
  .print-section:last-child{page-break-after:auto}
  h1{font-size:26px;border-bottom:3px solid #6366f1;padding-bottom:10px;margin-bottom:6px}
  .meta{color:#666;font-size:12px;margin-bottom:8px}
  .tags{margin-bottom:12px}
  .tags span{display:inline-block;background:#eef2ff;color:#6366f1;padding:3px 10px;border-radius:99px;font-size:11px;margin-right:6px;font-weight:500}
  .notes{background:#f5f5f7;padding:14px;border-radius:8px;margin-bottom:18px;white-space:pre-wrap}
  .notes-label{font-weight:bold;color:#6366f1;margin-bottom:4px;font-size:13px}
  .img-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
  .print-img{border:1px solid #ddd;border-radius:8px;overflow:hidden;page-break-inside:avoid}
  .print-img img{width:100%;display:block}
  @page{margin:1cm}
</style></head><body>
${sectionsHtml}
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),800))<\/script>
</body></html>`);
  win.document.close();
}

async function batchDelete() {
  const pids = Array.from(state.selectedPids);
  if (pids.length === 0) return;
  if (!confirm(`確定刪除 ${pids.length} 個品號？此操作無法復原。`)) return;
  if (!confirm(`真的確定？\n\n將刪除：\n${pids.slice(0,10).join(', ')}${pids.length > 10 ? `\n...等共 ${pids.length} 個` : ''}`)) return;

  showLoading(true);
  let ok = 0, fail = 0;
  for (const pid of pids) {
    try {
      const res = await apiPost({ action: 'delete', productId: pid });
      if (res.error) throw new Error(res.error);
      ok++;
    } catch (e) {
      fail++;
    }
  }
  showLoading(false);
  showToast(`刪除完成 ✅ ${ok} / ❌ ${fail}`, fail === 0 ? 'success' : 'error');
  clearSelection();
  loadAllSamples(true);
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

function showImportCsvModal() {
  openModal(`
    <div class="modal-header">
      <h3 class="modal-title">📥 匯入 CSV（更新注意事項）</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="csv-import-info">
      <p>⚠️ 此功能<strong>只能更新既有品號</strong>的注意事項，<strong>無法</strong>建立新品號（須有照片）。</p>
      <p>CSV 格式：<code>品號,注意事項</code>（第一列為標題列）</p>
      <p>範例：</p>
      <pre class="csv-example">品號,注意事項
PID-001,易碎 #易碎 #小心
PID-002,需冷藏保存 #冷藏</pre>
    </div>
    <div class="form-group">
      <label class="form-label">選擇 CSV 檔案</label>
      <input type="file" class="form-input" id="csvFileInput" accept=".csv,text/csv" onchange="parseCsvPreview(event)" />
    </div>
    <div id="csvPreview"></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" id="btnImportCsv" disabled onclick="submitCsvImport()">匯入</button>
    </div>
  `);
}

let csvParsedRows = [];

function parseCsvPreview(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const text = String(ev.target.result || '').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      document.getElementById('csvPreview').innerHTML = '<p style="color:var(--danger)">CSV 至少要有標題列 + 1 筆資料</p>';
      return;
    }
    // 簡易 CSV 解析（支援 quoted）
    const parseLine = line => {
      const cells = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
          if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (c === '"') inQ = false;
          else cur += c;
        } else {
          if (c === ',') { cells.push(cur); cur = ''; }
          else if (c === '"' && cur === '') inQ = true;
          else cur += c;
        }
      }
      cells.push(cur);
      return cells;
    };

    const rows = lines.slice(1).map(parseLine);
    csvParsedRows = rows.map(r => ({ pid: (r[0] || '').trim(), notes: (r[1] || '').trim() }));

    const existingPids = new Set(state.allSamples.map(s => String(s.productId).toUpperCase()));
    const matched = [];
    const skipped = [];
    csvParsedRows.forEach(r => {
      if (!r.pid) return;
      if (existingPids.has(r.pid.toUpperCase())) matched.push(r);
      else skipped.push(r);
    });

    let html = `
      <div class="csv-stats">
        <span class="csv-ok">✅ 將更新 ${matched.length} 筆</span>
        ${skipped.length ? `<span class="csv-skip">⚠️ 跳過 ${skipped.length} 筆（找不到品號）</span>` : ''}
      </div>
      <table class="csv-table">
        <thead><tr><th>品號</th><th>新注意事項</th><th>狀態</th></tr></thead>
        <tbody>
    `;
    [...matched, ...skipped].slice(0, 50).forEach(r => {
      const isMatched = existingPids.has(r.pid.toUpperCase());
      html += `<tr class="${isMatched ? '' : 'csv-row-skip'}">
        <td><strong>${escapeHtml(r.pid)}</strong></td>
        <td>${escapeHtml(r.notes.slice(0, 60))}${r.notes.length > 60 ? '…' : ''}</td>
        <td>${isMatched ? '✅ 將更新' : '⚠️ 跳過'}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
    if (csvParsedRows.length > 50) html += `<p style="color:var(--text-muted);text-align:center;font-size:0.85rem">…僅顯示前 50 筆</p>`;

    document.getElementById('csvPreview').innerHTML = html;
    document.getElementById('btnImportCsv').disabled = matched.length === 0;
    csvParsedRows.matched = matched;
  };
  reader.readAsText(file, 'utf-8');
}

async function submitCsvImport() {
  const matched = csvParsedRows.matched || [];
  if (matched.length === 0) return;

  showLoading(true);
  let ok = 0, fail = 0;
  for (const r of matched) {
    try {
      const res = await apiPost({
        action: 'update',
        originalProductId: r.pid,
        productId: r.pid,
        notes: r.notes,
        deletedImageIds: [],
        newImages: [],
      });
      if (res.error) throw new Error(res.error);
      ok++;
    } catch (e) { fail++; }
  }
  showLoading(false);
  showToast(`匯入完成 ✅ ${ok} / ❌ ${fail}`, fail === 0 ? 'success' : 'error');
  closeModal();
  loadAllSamples(true);
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
// 查詢統計（localStorage 累計）
// ============================================================
const LS_HIT_KEY = 'samples_hits_v1';

function recordHit(productId) {
  if (!productId) return;
  try {
    const map = JSON.parse(localStorage.getItem(LS_HIT_KEY) || '{}');
    if (!map[productId]) map[productId] = { count: 0, last: 0 };
    map[productId].count++;
    map[productId].last = Date.now();
    localStorage.setItem(LS_HIT_KEY, JSON.stringify(map));
  } catch (e) {}
}

function getHitStats() {
  try {
    return JSON.parse(localStorage.getItem(LS_HIT_KEY) || '{}');
  } catch (e) { return {}; }
}

function clearHitStats() {
  if (!confirm('確定清空查詢統計？')) return;
  localStorage.removeItem(LS_HIT_KEY);
  showToast('已清空', 'success');
  showStatsDashboard();
}

function showStatsDashboard() {
  const map = getHitStats();
  const samples = state.allSamples || [];
  const validPids = new Set(samples.map(s => String(s.productId)));

  const entries = Object.entries(map)
    .filter(([pid]) => validPids.has(pid))
    .sort((a, b) => b[1].count - a[1].count);

  const totalQueries = entries.reduce((sum, [, v]) => sum + v.count, 0);
  const top20 = entries.slice(0, 20);

  // 30 天活躍度（每天有多少查詢）
  const thirty = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const days = {};
  for (const [, v] of entries) {
    if (v.last >= thirty) {
      const d = new Date(v.last).toISOString().slice(0, 10);
      days[d] = (days[d] || 0) + v.count;
    }
  }
  const dayList = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { d, c: days[d] || 0 };
  });
  const maxC = Math.max(1, ...dayList.map(x => x.c));

  const sparkline = dayList.map(x => {
    const h = (x.c / maxC) * 100;
    return `<div class="spark-bar" style="height:${h}%" title="${x.d}: ${x.c} 次"></div>`;
  }).join('');

  let topHtml = '';
  if (top20.length === 0) {
    topHtml = '<div class="empty-state"><p>尚無查詢紀錄</p></div>';
  } else {
    topHtml = `
      <table class="stats-table">
        <thead><tr><th>排名</th><th>品號</th><th>查詢次數</th><th>最近查詢</th></tr></thead>
        <tbody>
          ${top20.map(([pid, v], i) => `
            <tr>
              <td>${i + 1}</td>
              <td><strong>${escapeHtml(pid)}</strong></td>
              <td><span class="stat-count">${v.count}</span></td>
              <td>${new Date(v.last).toLocaleString('zh-TW')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  openModal(`
    <div class="modal-header">
      <h3 class="modal-title">📊 查詢統計</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="stats-summary">
      <div class="stats-summary-card">
        <div class="ssc-value">${totalQueries}</div>
        <div class="ssc-label">總查詢次數</div>
      </div>
      <div class="stats-summary-card">
        <div class="ssc-value">${entries.length}</div>
        <div class="ssc-label">獨立品號</div>
      </div>
      <div class="stats-summary-card">
        <div class="ssc-value">${Object.keys(days).length}</div>
        <div class="ssc-label">活躍天數 (30d)</div>
      </div>
    </div>
    <div class="stats-section">
      <h4>📈 近 30 天活躍度</h4>
      <div class="sparkline-box">${sparkline}</div>
    </div>
    <div class="stats-section">
      <h4>🔥 熱門品號 Top 20</h4>
      ${topHtml}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="clearHitStats()">🗑 清空統計</button>
      <button class="btn btn-secondary" onclick="closeModal()">關閉</button>
    </div>
    <p class="stats-note">💡 統計只記錄此裝置的查詢紀錄，不會上傳。</p>
  `);
}

// ============================================================
// 標籤系統 (#tag 從 notes 解析)
// ============================================================
const TAG_REGEX = /#([^\s#,]+)/g;

function extractTags(notes) {
  if (!notes) return [];
  const tags = [];
  let m;
  while ((m = TAG_REGEX.exec(notes)) !== null) {
    tags.push(m[1]);
  }
  return [...new Set(tags)];
}

function notesWithoutTags(notes) {
  if (!notes) return '';
  return notes.replace(TAG_REGEX, '').replace(/\s+/g, ' ').trim();
}

function renderTagsHtml(tags) {
  if (!tags || tags.length === 0) return '';
  return `<div class="card-tags">${tags.map(t =>
    `<button class="tag-chip" onclick="filterByTag(event, '${escapeHtml(t)}')" title="點擊篩選此標籤">#${escapeHtml(t)}</button>`
  ).join('')}</div>`;
}

function filterByTag(e, tag) {
  e.stopPropagation();
  const input = state.mode === 'admin'
    ? document.getElementById('adminSearchInput')
    : document.getElementById('searchInput');
  if (!input) return;
  input.value = '#' + tag;
  if (state.mode === 'admin') {
    handleAdminSearch({ target: input });
  } else {
    performSearch('#' + tag);
  }
  input.focus();
}

// 全部出現過的標籤（給匯入/編輯時做 autocomplete suggest）
function getAllTagsFromSamples() {
  const set = new Set();
  for (const s of state.allSamples || []) {
    for (const t of extractTags(s.notes)) set.add(t);
  }
  return Array.from(set).sort();
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

// ============================================================
// 照片標註器 (Canvas)
// 設計：
//   - 用 high-res Drive thumbnail (w1600) 作底
//   - 操作 stroke 存在 ann.strokes 陣列以支援 undo
//   - 儲存時把 image + strokes 合成到 canvas → blob → base64 → 上傳
//   - 上傳路徑用既有 update API 的 newImages，不動原檔
// ============================================================
const ann = {
  active: false,
  color: '#ef4444',
  size: 3,
  mode: 'pen', // 'pen' | 'rect' | 'arrow'
  strokes: [], // {color, size, mode, points: [{x, y}, ...]}
  current: null,
  baseImg: null,
  baseImgLoaded: false,
};

function openAnnotator() {
  const fileId = state.currentLightboxFileId;
  const productId = state.currentLightboxProductId;
  if (!fileId || !productId) return;
  if (!state.isAdminLoggedIn) {
    showToast('需要管理員權限才能標註', 'error');
    return;
  }

  ann.strokes = [];
  ann.current = null;
  ann.baseImgLoaded = false;
  ann.targetFileId = fileId;
  ann.targetProductId = productId;

  const overlay = document.getElementById('annotatorOverlay');
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  // 顯示 loading
  showLoading(true);
  // drive.google.com 沒回 CORS → canvas 會 tainted → toBlob 失敗
  // 改走 GAS proxy 拿 base64，再用 dataURL 載入，canvas 乾淨
  loadImageViaProxy(fileId).then(img => {
    showLoading(false);
    ann.baseImg = img;
    ann.baseImgLoaded = true;
    setupAnnCanvas();
    drawAnn();
  }).catch(err => {
    showLoading(false);
    closeAnnotator();
    showToast('圖片載入失敗：' + err.message, 'error');
  });
}

async function loadImageViaProxy(fileId) {
  // GAS serveImage 回 base64 string
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', 'getImage');
  url.searchParams.set('fileId', fileId);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const base64 = await res.text();
  if (!base64) throw new Error('空回應');
  const dataUrl = 'data:image/jpeg;base64,' + base64;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('圖片解碼失敗'));
    img.src = dataUrl;
  });
}

function setupAnnCanvas() {
  const canvas = document.getElementById('annotatorCanvas');
  const stage = document.getElementById('annotatorStage');
  if (!canvas || !ann.baseImg) return;

  // 適應視窗：保留標註座標一致 → 內部 canvas 尺寸 = 圖片原始尺寸
  canvas.width = ann.baseImg.naturalWidth;
  canvas.height = ann.baseImg.naturalHeight;

  // CSS 縮放適應 stage
  const stageRect = stage.getBoundingClientRect();
  const ratio = Math.min(stageRect.width / canvas.width, stageRect.height / canvas.height);
  canvas.style.width = (canvas.width * ratio) + 'px';
  canvas.style.height = (canvas.height * ratio) + 'px';

  // 註冊事件
  canvas.onpointerdown = onAnnPointerDown;
  canvas.onpointermove = onAnnPointerMove;
  canvas.onpointerup = onAnnPointerUp;
  canvas.onpointerleave = onAnnPointerUp;
}

function getAnnCoords(e) {
  const canvas = document.getElementById('annotatorCanvas');
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function onAnnPointerDown(e) {
  e.preventDefault();
  e.target.setPointerCapture(e.pointerId);
  const p = getAnnCoords(e);
  ann.current = {
    color: ann.color,
    size: ann.size * (ann.baseImg.naturalWidth / 1000), // 依圖大小縮放
    mode: ann.mode,
    points: [p],
  };
}

function onAnnPointerMove(e) {
  if (!ann.current) return;
  const p = getAnnCoords(e);
  if (ann.current.mode === 'pen') {
    ann.current.points.push(p);
  } else {
    // rect / arrow 只記起點與終點
    ann.current.points = [ann.current.points[0], p];
  }
  drawAnn();
}

function onAnnPointerUp(e) {
  if (!ann.current) return;
  ann.strokes.push(ann.current);
  ann.current = null;
  drawAnn();
}

function drawAnn() {
  const canvas = document.getElementById('annotatorCanvas');
  if (!canvas || !ann.baseImg) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(ann.baseImg, 0, 0);

  const all = [...ann.strokes];
  if (ann.current) all.push(ann.current);
  for (const s of all) drawStroke(ctx, s);
}

function drawStroke(ctx, s) {
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (s.mode === 'pen') {
    if (s.points.length < 2) {
      ctx.beginPath();
      ctx.arc(s.points[0].x, s.points[0].y, s.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke();
    }
  } else if (s.mode === 'rect' && s.points.length >= 2) {
    const [a, b] = [s.points[0], s.points[s.points.length - 1]];
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  } else if (s.mode === 'arrow' && s.points.length >= 2) {
    const [a, b] = [s.points[0], s.points[s.points.length - 1]];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // 箭頭頭
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const headLen = s.size * 5;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - headLen * Math.cos(angle - Math.PI / 7), b.y - headLen * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(b.x - headLen * Math.cos(angle + Math.PI / 7), b.y - headLen * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function setAnnColor(btn, color) {
  ann.color = color;
  document.querySelectorAll('.ann-color').forEach(b => b.classList.toggle('active', b === btn));
}
function setAnnSize(btn, size) {
  ann.size = size;
  document.querySelectorAll('.ann-size').forEach(b => b.classList.toggle('active', b === btn));
}
function setAnnMode(btn, mode) {
  ann.mode = mode;
  document.querySelectorAll('.ann-mode').forEach(b => b.classList.toggle('active', b === btn));
}
function annUndo() {
  ann.strokes.pop();
  drawAnn();
}
function annClear() {
  if (ann.strokes.length === 0) return;
  if (!confirm('確定清除所有標註？')) return;
  ann.strokes = [];
  drawAnn();
}

function closeAnnotator() {
  const overlay = document.getElementById('annotatorOverlay');
  overlay.classList.remove('active');
  document.body.style.overflow = '';
  ann.strokes = [];
  ann.current = null;
  ann.baseImg = null;
  ann.tainted = false;
}

async function saveAnnotation() {
  if (!ann.baseImg) return;
  if (ann.strokes.length === 0) {
    showToast('還沒畫東西', 'error');
    return;
  }

  const canvas = document.getElementById('annotatorCanvas');
  let blob;
  try {
    blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob 失敗')), 'image/jpeg', 0.9);
    });
  } catch (e) {
    showToast('儲存失敗：' + e.message + '（可能因跨網域）', 'error');
    return;
  }

  // 轉 base64
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result;
    const base64 = dataUrl.split(',')[1];
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `標註_${ts}.jpg`;

    showLoading(true);
    try {
      const res = await apiPost({
        action: 'update',
        originalProductId: ann.targetProductId,
        productId: ann.targetProductId,
        notes: undefined,
        deletedImageIds: [],
        newImages: [{
          fileName,
          mimeType: 'image/jpeg',
          mediaType: 'image',
          data: base64,
        }],
      });
      if (res.error) throw new Error(res.error);
      showToast('標註已儲存為新照片', 'success');
      closeAnnotator();
      closeLightbox();
      loadAllSamples(true);
    } catch (e) {
      showToast('上傳失敗：' + e.message, 'error');
    } finally {
      showLoading(false);
    }
  };
  reader.readAsDataURL(blob);
}

// 視窗 resize 時重設 canvas 顯示尺寸
window.addEventListener('resize', () => {
  if (document.getElementById('annotatorOverlay')?.classList.contains('active')) {
    setupAnnCanvas();
    drawAnn();
  }
});

// ESC 關閉標註器
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('annotatorOverlay')?.classList.contains('active')) {
    closeAnnotator();
  }
});
