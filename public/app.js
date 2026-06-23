// ═══════════════════════════════════════════════════════════════════════════════
// AeroDMS — Frontend Application Logic
// ═══════════════════════════════════════════════════════════════════════════════

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  token: localStorage.getItem('dms_token') || null,
  currentUser: null,
  projects: [],
  folders: [],
  documents: [],
  auditLogs: [],
  users: [],
  activeTab: 'explorer',
  selectedProjectId: null,
  selectedFolderId: null,
  selectedFile: null,
  theme: localStorage.getItem('theme') || 'dark'
};

const API = {
  base: '',
  headers() {
    return { 'Content-Type': 'application/json', 'x-auth-token': state.token || '' };
  },
  authHeaders() {
    return { 'x-auth-token': state.token || '' };
  }
};

// ─── API HELPER ───────────────────────────────────────────────────────────────
async function apiRequest(endpoint, options = {}) {
  try {
    if (!options.headers) options.headers = {};
    options.headers['x-auth-token'] = state.token || '';

    const res = await fetch(`${API.base}${endpoint}`, options);
    if (res.status === 401) { handleLogout(true); return null; }
    if (!res.ok) {
      let errMsg = 'Request failed';
      try { const j = await res.json(); errMsg = j.error || errMsg; } catch(e) {}
      throw new Error(errMsg);
    }
    // Handle empty body (e.g., downloads, 204)
    const ct = res.headers.get('content-type');
    if (ct && ct.includes('application/json')) return await res.json();
    return null;
  } catch (err) {
    showToast(err.message, 'error');
    throw err;
  }
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toast-message');
  msgEl.textContent = msg;
  toast.className = `toast toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ─── FORMAT HELPERS ───────────────────────────────────────────────────────────
function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

function formatDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH — LOGIN / LOGOUT
// ═══════════════════════════════════════════════════════════════════════════════

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');

  btn.disabled = true;
  btn.textContent = 'Signing in...';
  errEl.classList.add('hidden');

  try {
    const data = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const json = await data.json();

    if (!data.ok) {
      errEl.textContent = json.error || 'Login failed.';
      errEl.classList.remove('hidden');
      return;
    }

    state.token = json.token;
    state.currentUser = json.user;
    localStorage.setItem('dms_token', json.token);
    enterApp();
  } catch (err) {
    errEl.textContent = 'Connection error. Is the server running?';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Sign In`;
  }
});

async function checkExistingSession() {
  if (!state.token) { showLoginPage(); return; }
  try {
    const res = await fetch('/api/auth/me', { headers: { 'x-auth-token': state.token } });
    if (res.ok) {
      state.currentUser = await res.json();
      enterApp();
    } else {
      state.token = null;
      localStorage.removeItem('dms_token');
      showLoginPage();
    }
  } catch {
    showLoginPage();
  }
}

function showLoginPage() {
  document.getElementById('login-page').classList.remove('hidden');
  document.getElementById('app-page').classList.add('hidden');
}

function enterApp() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app-page').classList.remove('hidden');
  setupUIForRole();
  loadAllData();
  applyTheme();
}

function setupUIForRole() {
  const user = state.currentUser;
  if (!user) return;

  // Sidebar user info
  const initials = user.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('sidebar-avatar').textContent = initials;
  document.getElementById('sidebar-name').textContent = user.full_name;
  document.getElementById('sidebar-role').textContent = user.role.charAt(0).toUpperCase() + user.role.slice(1);
  document.getElementById('header-role-badge').textContent = user.role;
  document.getElementById('header-role-badge').className = `role-badge role-${user.role}`;

  // Role-based visibility
  const isAdmin = user.role === 'admin';
  const isEditor = user.role === 'editor' || isAdmin;

  document.getElementById('nav-users').style.display = isAdmin ? '' : 'none';
  document.getElementById('btn-add-project').style.display = isEditor ? '' : 'none';
  document.getElementById('btn-add-folder').style.display = isEditor ? '' : 'none';
  document.getElementById('btn-upload-direct').style.display = isEditor ? '' : 'none';
  document.getElementById('nav-upload').style.display = isEditor ? '' : 'none';
}

async function handleLogout(expired = false) {
  if (state.token) {
    try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-auth-token': state.token } }); } catch {}
  }
  state.token = null;
  state.currentUser = null;
  localStorage.removeItem('dms_token');
  if (expired) showToast('Session expired. Please log in again.', 'error');
  showLoginPage();
}

document.getElementById('logout-btn').addEventListener('click', () => handleLogout(false));

// ═══════════════════════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════════════════════

async function loadAllData() {
  try {
    const [projects, folders, docs, logs, stats] = await Promise.all([
      apiRequest('/api/projects'),
      apiRequest('/api/folders'),
      apiRequest('/api/documents'),
      apiRequest('/api/logs'),
      apiRequest('/api/stats')
    ]);

    state.projects = projects || [];
    state.folders = folders || [];
    state.documents = docs || [];
    state.auditLogs = logs || [];

    if (stats) {
      document.getElementById('stat-projects-count').textContent = stats.projects;
      document.getElementById('stat-documents-count').textContent = stats.documents;
      document.getElementById('stat-users-count').textContent = stats.users;
      document.getElementById('stat-storage-size').textContent = formatBytes(stats.storage);
      document.getElementById('badge-logs-count').textContent = `${stats.logs} entries`;
    }

    renderProjectTree();
    populateSelectDropdowns();
    renderLibraryTable();
    renderAuditLogs();

    if (state.currentUser?.role === 'admin') {
      const users = await apiRequest('/api/users');
      state.users = users || [];
      renderUsersTable();
    }

    // Refresh explorer if something selected
    if (state.selectedProjectId) {
      openExplorerItem(state.selectedProjectId, state.selectedFolderId);
    }
  } catch (err) {
    console.error('Data load error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPLORER — TREE
// ═══════════════════════════════════════════════════════════════════════════════

function renderProjectTree() {
  const container = document.getElementById('project-tree-container');
  container.innerHTML = '';

  if (state.projects.length === 0) {
    container.innerHTML = '<div class="tree-empty">No projects yet. Create one to get started!</div>';
    return;
  }

  state.projects.forEach(project => {
    const node = createProjectTreeNode(project);
    container.appendChild(node);
  });
}

function createProjectTreeNode(project) {
  const isEditor = ['admin', 'editor'].includes(state.currentUser?.role);
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-node-wrapper project-node';
  wrapper.dataset.id = project.id;

  const rootFolders = state.folders.filter(f => f.project_id === project.id && !f.parent_folder_id);
  const isSelected = state.selectedProjectId === project.id && !state.selectedFolderId;

  wrapper.innerHTML = `
    <div class="tree-node-header ${isSelected ? 'selected' : ''}">
      <div class="tree-node-left">
        <svg class="tree-arrow ${rootFolders.length > 0 ? '' : 'invisible'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        <svg class="tree-icon project-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
        <span class="tree-node-label">${escHtml(project.name)}</span>
        <span class="tree-count">${state.folders.filter(f => f.project_id === project.id).length}</span>
      </div>
      <div class="tree-actions">
        ${isEditor ? `<button class="tree-btn add-folder-btn" title="Add Folder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>` : ''}
        ${state.currentUser?.role === 'admin' ? `<button class="tree-btn delete delete-node-btn" title="Delete Project"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>` : ''}
      </div>
    </div>
    <div class="tree-node-children"></div>
  `;

  const header = wrapper.querySelector('.tree-node-header');
  const childrenDiv = wrapper.querySelector('.tree-node-children');
  const arrow = wrapper.querySelector('.tree-arrow');

  // Click to select/expand
  header.addEventListener('click', (e) => {
    if (e.target.closest('.tree-btn')) return;
    state.selectedProjectId = project.id;
    state.selectedFolderId = null;
    arrow.classList.toggle('expanded');
    childrenDiv.classList.toggle('expanded');
    openExplorerItem(project.id, null);
    highlightTreeNode(header);
  });

  // Add folder btn
  const addFolderBtn = wrapper.querySelector('.add-folder-btn');
  if (addFolderBtn) {
    addFolderBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openFolderModal(project.id, null, project.name);
    });
  }

  // Delete project btn
  const deleteBtn = wrapper.querySelector('.delete-node-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete project "${project.name}"?\n\nAll folders and documents will be permanently deleted.`)) return;
      try {
        await apiRequest(`/api/projects/${project.id}`, { method: 'DELETE' });
        if (state.selectedProjectId === project.id) { state.selectedProjectId = null; state.selectedFolderId = null; resetExplorerPanel(); }
        showToast(`Project "${project.name}" deleted.`);
        loadAllData();
      } catch {}
    });
  }

  // Expand if this project was selected
  if (state.selectedProjectId === project.id) {
    arrow.classList.add('expanded');
    childrenDiv.classList.add('expanded');
  }

  // Build folder subtree
  rootFolders.forEach(folder => {
    childrenDiv.appendChild(createFolderTreeNode(folder, project));
  });

  return wrapper;
}

function createFolderTreeNode(folder, project) {
  const isEditor = ['admin', 'editor'].includes(state.currentUser?.role);
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-node-wrapper folder-node';
  wrapper.dataset.id = folder.id;

  const subFolders = state.folders.filter(f => f.parent_folder_id === folder.id);
  const isSelected = state.selectedFolderId === folder.id;
  const docCount = state.documents.filter(d => d.folder_id === folder.id).length;

  wrapper.innerHTML = `
    <div class="tree-node-header ${isSelected ? 'selected' : ''}">
      <div class="tree-node-left">
        <svg class="tree-arrow ${subFolders.length > 0 ? '' : 'invisible'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        <svg class="tree-icon folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span class="tree-node-label">${escHtml(folder.name)}</span>
        ${docCount > 0 ? `<span class="tree-count">${docCount}</span>` : ''}
      </div>
      <div class="tree-actions">
        ${isEditor ? `<button class="tree-btn delete delete-node-btn" title="Delete Folder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>` : ''}
      </div>
    </div>
    <div class="tree-node-children"></div>
  `;

  const header = wrapper.querySelector('.tree-node-header');
  const childrenDiv = wrapper.querySelector('.tree-node-children');
  const arrow = wrapper.querySelector('.tree-arrow');

  header.addEventListener('click', (e) => {
    if (e.target.closest('.tree-btn')) return;
    state.selectedProjectId = project.id;
    state.selectedFolderId = folder.id;
    arrow.classList.toggle('expanded');
    childrenDiv.classList.toggle('expanded');
    openExplorerItem(project.id, folder.id);
    highlightTreeNode(header);
  });

  const deleteBtn = wrapper.querySelector('.delete-node-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete folder "${folder.name}"?\n\nAll documents inside will be permanently deleted.`)) return;
      try {
        await apiRequest(`/api/folders/${folder.id}`, { method: 'DELETE' });
        if (state.selectedFolderId === folder.id) { state.selectedFolderId = null; openExplorerItem(state.selectedProjectId, null); }
        showToast(`Folder "${folder.name}" deleted.`);
        loadAllData();
      } catch {}
    });
  }

  if (state.selectedFolderId === folder.id) {
    arrow.classList.add('expanded');
    childrenDiv.classList.add('expanded');
  }

  subFolders.forEach(sub => childrenDiv.appendChild(createFolderTreeNode(sub, project)));

  return wrapper;
}

function highlightTreeNode(header) {
  document.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('selected'));
  header.classList.add('selected');
}

// ─── EXPLORER DETAIL VIEW ─────────────────────────────────────────────────────

function openExplorerItem(projectId, folderId) {
  state.selectedProjectId = projectId;
  state.selectedFolderId = folderId;

  const isEditor = ['admin', 'editor'].includes(state.currentUser?.role);
  document.getElementById('btn-add-folder').disabled = !projectId || !isEditor;
  document.getElementById('btn-upload-direct').disabled = !folderId || !isEditor;

  document.getElementById('explorer-placeholder').classList.add('hidden');
  document.getElementById('explorer-content').classList.remove('hidden');

  renderBreadcrumbs(projectId, folderId);

  // Folders
  const subFolders = state.folders.filter(f =>
    folderId ? f.parent_folder_id === folderId : (f.project_id === projectId && !f.parent_folder_id)
  );

  const foldersEl = document.getElementById('explorer-folders-list');
  foldersEl.innerHTML = '';
  if (subFolders.length === 0) {
    foldersEl.innerHTML = '<div class="text-secondary empty-hint">No folders here. Use "New Folder" to create one.</div>';
  } else {
    subFolders.forEach(folder => {
      const docCount = state.documents.filter(d => d.folder_id === folder.id).length;
      const box = document.createElement('div');
      box.className = 'folder-box';
      box.innerHTML = `
        <div class="folder-box-info">
          <svg class="folder-box-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <div>
            <span class="folder-box-name">${escHtml(folder.name)}</span>
            <span class="folder-box-count">${docCount} doc${docCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
        ${isEditor ? `<button class="folder-box-delete" title="Delete Folder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>` : ''}
      `;
      box.addEventListener('click', (e) => {
        if (e.target.closest('.folder-box-delete')) return;
        openExplorerItem(projectId, folder.id);
        // sync tree
        const treeNode = document.querySelector(`.folder-node[data-id="${folder.id}"] .tree-node-header`);
        if (treeNode) highlightTreeNode(treeNode);
      });
      const delBtn = box.querySelector('.folder-box-delete');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm(`Delete folder "${folder.name}"?`)) return;
          try {
            await apiRequest(`/api/folders/${folder.id}`, { method: 'DELETE' });
            showToast(`Folder "${folder.name}" deleted.`);
            loadAllData();
          } catch {}
        });
      }
      foldersEl.appendChild(box);
    });
  }

  // Documents
  const folderDocs = state.documents.filter(d => d.folder_id === folderId);
  const docsEl = document.getElementById('explorer-documents-list');
  docsEl.innerHTML = '';

  if (!folderId) {
    docsEl.innerHTML = '<div class="text-secondary empty-hint">Select a folder to see its documents.</div>';
  } else if (folderDocs.length === 0) {
    docsEl.innerHTML = '<div class="text-secondary empty-hint">No documents yet. Click "Upload Here" to add files.</div>';
  } else {
    folderDocs.forEach(doc => {
      const card = document.createElement('div');
      card.className = 'doc-card';
      const ext = doc.name.split('.').pop().toUpperCase();
      card.innerHTML = `
        <div class="doc-card-header">
          <div class="doc-ext-badge">${escHtml(ext)}</div>
          <div class="doc-card-actions">
            <button class="doc-action-btn open-btn" title="Open in New Tab"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>
            <button class="doc-action-btn view-btn" title="View Document"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>
            <button class="doc-action-btn props-btn" title="Properties & Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
            <button class="doc-action-btn download-btn" title="Download"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
            ${isEditor ? `<button class="doc-action-btn delete delete-btn" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>` : ''}
          </div>
        </div>
        <div class="doc-card-name" title="${escHtml(doc.name)}">${escHtml(doc.name)}</div>
        <div class="doc-card-meta">
          <span class="badge badge-primary">${escHtml(doc.category)}</span>
        </div>
        <div class="doc-card-footer">
          <span class="doc-card-version">${escHtml(doc.version)}</span>
          <span class="doc-card-size">${formatBytes(doc.size)}</span>
        </div>
      `;
      card.querySelector('.open-btn').addEventListener('click', () => {
        window.open(`/viewer/${doc.id}?token=${encodeURIComponent(state.token)}`, '_blank');
      });
      card.querySelector('.view-btn').addEventListener('click', () => {
        window.open(`/viewer/${doc.id}?token=${encodeURIComponent(state.token)}`, '_blank');
      });
      card.querySelector('.props-btn').addEventListener('click', () => openDocModal(doc));
      card.querySelector('.download-btn').addEventListener('click', () => downloadDoc(doc.id, doc.name));

      // Make card name and ext badge clickable to open in new tab
      const cardName = card.querySelector('.doc-card-name');
      cardName.style.cursor = 'pointer';
      cardName.addEventListener('click', () => {
        window.open(`/viewer/${doc.id}?token=${encodeURIComponent(state.token)}`, '_blank');
      });

      const extBadge = card.querySelector('.doc-ext-badge');
      extBadge.style.cursor = 'pointer';
      extBadge.addEventListener('click', () => {
        window.open(`/viewer/${doc.id}?token=${encodeURIComponent(state.token)}`, '_blank');
      });
      const delBtn = card.querySelector('.delete-btn');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm(`Delete "${doc.name}"?`)) return;
          try {
            await apiRequest(`/api/documents/${doc.id}`, { method: 'DELETE' });
            showToast(`"${doc.name}" deleted.`);
            loadAllData();
          } catch {}
        });
      }
      docsEl.appendChild(card);
    });
  }
}

function resetExplorerPanel() {
  const isEditor = ['admin', 'editor'].includes(state.currentUser?.role);
  document.getElementById('btn-add-folder').disabled = true;
  document.getElementById('btn-upload-direct').disabled = true;
  document.getElementById('explorer-placeholder').classList.remove('hidden');
  document.getElementById('explorer-content').classList.add('hidden');
}

// ─── BREADCRUMBS ──────────────────────────────────────────────────────────────
function renderBreadcrumbs(projectId, folderId) {
  const el = document.getElementById('explorer-breadcrumbs');
  el.innerHTML = '';

  const addCrumb = (text, onClick, isActive = false) => {
    const span = document.createElement('span');
    span.className = `breadcrumb-item${isActive ? ' active' : ''}`;
    span.textContent = text;
    if (onClick && !isActive) span.addEventListener('click', onClick);
    el.appendChild(span);
    if (!isActive) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-separator';
      sep.textContent = '/';
      el.appendChild(sep);
    }
  };

  addCrumb('Projects', () => { state.selectedProjectId = null; state.selectedFolderId = null; resetExplorerPanel(); document.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('selected')); });

  if (projectId) {
    const proj = state.projects.find(p => p.id === projectId);
    addCrumb(proj?.name || 'Project', !folderId ? null : () => openExplorerItem(projectId, null), !folderId);
  }

  if (folderId) {
    const ancestry = getFolderAncestry(folderId);
    ancestry.forEach((f, i) => {
      const isLast = i === ancestry.length - 1;
      addCrumb(f.name, isLast ? null : () => openExplorerItem(projectId, f.id), isLast);
    });
  }
}

function getFolderAncestry(folderId) {
  const path = [];
  let cur = state.folders.find(f => f.id === folderId);
  while (cur) { path.unshift(cur); cur = state.folders.find(f => f.id === cur.parent_folder_id); }
  return path;
}

// ─── DROPDOWNS ────────────────────────────────────────────────────────────────
function populateSelectDropdowns() {
  const buildOptions = (arr, placeholder) =>
    `<option value="">${placeholder}</option>` + arr.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');

  document.getElementById('upload-project').innerHTML = buildOptions(state.projects, '-- Choose Project --');
  document.getElementById('lib-filter-project').innerHTML = buildOptions(state.projects, 'All Projects');
}

document.getElementById('upload-project').addEventListener('change', () => {
  const pid = parseInt(document.getElementById('upload-project').value);
  const folderSel = document.getElementById('upload-folder');
  folderSel.innerHTML = '<option value="">-- Choose Folder --</option>';
  if (!pid) { folderSel.disabled = true; return; }
  folderSel.disabled = false;
  state.folders.filter(f => f.project_id === pid).forEach(f => {
    const ancestry = getFolderAncestry(f.id);
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = ancestry.map(a => a.name).join(' / ');
    folderSel.appendChild(opt);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD WIZARD
// ═══════════════════════════════════════════════════════════════════════════════

// Drag & drop
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
});
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { if (fileInput.files.length > 0) handleFileSelect(fileInput.files[0]); });

function handleFileSelect(file) {
  state.selectedFile = file;
  const fn = document.getElementById('drop-zone-filename');
  fn.textContent = `✓ ${file.name} (${formatBytes(file.size)})`;
  fn.classList.remove('hidden');
}

document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const folderId = document.getElementById('upload-folder').value;
  const file = state.selectedFile;
  if (!folderId || !file) { showToast('Please select a folder and file.', 'error'); return; }

  const btn = document.getElementById('btn-submit-upload');
  btn.disabled = true;

  const processCard = document.getElementById('upload-process-card');
  processCard.classList.remove('hidden');
  resetTimelineSteps();

  const formData = new FormData();
  formData.append('folder_id', folderId);
  formData.append('category', document.getElementById('upload-category').value);
  formData.append('tags', document.getElementById('upload-tags').value);
  formData.append('description', document.getElementById('upload-description').value);
  formData.append('file', file);

  try {
    setTimelineStep('step-uploading', 'active');

    // Animate progress bar while uploading
    let prog = 0;
    const progFill = document.getElementById('upload-progress-fill');
    const progInterval = setInterval(() => { prog = Math.min(prog + 8, 90); progFill.style.width = `${prog}%`; }, 120);

    const result = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'x-auth-token': state.token },
      body: formData
    });

    clearInterval(progInterval);
    progFill.style.width = '100%';

    if (!result.ok) {
      const err = await result.json();
      throw new Error(err.error || 'Upload failed.');
    }

    const doc = await result.json();
    await sleep(400);
    setTimelineStep('step-uploading', 'done');

    setTimelineStep('step-version', 'active');
    document.getElementById('lbl-gen-version').textContent = doc.version;
    await sleep(700);
    setTimelineStep('step-version', 'done');

    setTimelineStep('step-indexing', 'active');
    await sleep(600);
    setTimelineStep('step-indexing', 'done');

    setTimelineStep('step-completion', 'done');
    await sleep(400);

    showToast(`"${doc.name}" uploaded successfully! Version: ${doc.version}`);

    // Reset form
    document.getElementById('upload-form').reset();
    document.getElementById('upload-folder').disabled = true;
    state.selectedFile = null;
    document.getElementById('drop-zone-filename').classList.add('hidden');

    await loadAllData();
    processCard.classList.add('hidden');
    switchTab('library');

  } catch (err) {
    showToast(err.message || 'Upload failed.', 'error');
    processCard.classList.add('hidden');
  } finally {
    btn.disabled = false;
  }
});

function resetTimelineSteps() {
  ['step-uploading', 'step-version', 'step-indexing', 'step-completion'].forEach(id => {
    const step = document.getElementById(id);
    step.className = 'timeline-item';
    step.querySelector('.spinner').classList.add('hidden');
    step.querySelector('.check-icon').classList.add('hidden');
  });
  document.getElementById('upload-progress-fill').style.width = '0%';
  document.getElementById('lbl-gen-version').textContent = '...';
}

function setTimelineStep(stepId, status) {
  const step = document.getElementById(stepId);
  step.className = `timeline-item ${status}`;
  const spinner = step.querySelector('.spinner');
  const check = step.querySelector('.check-icon');
  if (status === 'active') { spinner.classList.remove('hidden'); check.classList.add('hidden'); }
  else if (status === 'done') { spinner.classList.add('hidden'); check.classList.remove('hidden'); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIBRARY TABLE
// ═══════════════════════════════════════════════════════════════════════════════

function renderLibraryTable() {
  const search = document.getElementById('lib-search').value.toLowerCase().trim();
  const filterProj = document.getElementById('lib-filter-project').value;
  const filterCat = document.getElementById('lib-filter-category').value;
  const isEditor = ['admin', 'editor'].includes(state.currentUser?.role);

  const filtered = state.documents.filter(doc => {
    const matchSearch = !search || [doc.name, doc.category, doc.tags, doc.description, doc.project_name, doc.folder_name]
      .some(v => v && v.toLowerCase().includes(search));
    const matchProj = !filterProj || doc.project_id == filterProj;
    const matchCat = !filterCat || doc.category === filterCat;
    return matchSearch && matchProj && matchCat;
  });

  const tbody = document.getElementById('library-tbody');
  tbody.innerHTML = '';
  const table = document.getElementById('library-table');
  const empty = document.getElementById('library-empty');

  if (filtered.length === 0) {
    table.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  table.classList.remove('hidden');
  empty.classList.add('hidden');

  filtered.forEach(doc => {
    const tagsHtml = doc.tags
      ? doc.tags.split(',').filter(t => t.trim()).map(t => `<span class="tag-pill">${escHtml(t.trim())}</span>`).join('')
      : '<span class="text-muted" style="font-size:.73rem">—</span>';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:9px;font-weight:600;">
          <div class="table-doc-icon">${escHtml(doc.name.split('.').pop().toUpperCase())}</div>
          <span class="lib-doc-name-link" title="${escHtml(doc.name)}" style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;">${escHtml(doc.name)}</span>
        </div>
      </td>
      <td style="color:var(--text-secondary);font-size:.82rem">${escHtml(doc.project_name)} / ${escHtml(doc.folder_name)}</td>
      <td><span class="version-chip">${escHtml(doc.version)}</span></td>
      <td><span class="badge badge-primary">${escHtml(doc.category)}</span></td>
      <td>${tagsHtml}</td>
      <td style="color:var(--text-secondary);font-size:.82rem">${formatBytes(doc.size)}</td>
      <td style="color:var(--text-muted);font-size:.78rem">${formatDate(doc.created_at)}</td>
      <td style="color:var(--text-muted);font-size:.78rem">${escHtml(doc.uploaded_by_name || '—')}</td>
      <td class="text-center">
        <div class="table-actions">
          <button class="doc-action-btn open-btn" title="Open in New Tab"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>
          <button class="doc-action-btn view-btn" title="View Document"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
          <button class="doc-action-btn props-btn" title="Properties & Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
          <button class="doc-action-btn download-btn" title="Download"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
          ${isEditor ? `<button class="doc-action-btn delete delete-btn" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>` : ''}
        </div>
      </td>
    `;

    tr.querySelector('.lib-doc-name-link').addEventListener('click', () => {
      window.open(`/viewer/${doc.id}?token=${encodeURIComponent(state.token)}`, '_blank');
    });
    tr.querySelector('.open-btn').addEventListener('click', () => {
      window.open(`/viewer/${doc.id}?token=${encodeURIComponent(state.token)}`, '_blank');
    });
    tr.querySelector('.view-btn').addEventListener('click', () => {
      window.open(`/viewer/${doc.id}?token=${encodeURIComponent(state.token)}`, '_blank');
    });
    tr.querySelector('.props-btn').addEventListener('click', () => openDocModal(doc));
    tr.querySelector('.download-btn').addEventListener('click', () => downloadDoc(doc.id, doc.name));
    const delBtn = tr.querySelector('.delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Delete "${doc.name}"?`)) return;
        try {
          await apiRequest(`/api/documents/${doc.id}`, { method: 'DELETE' });
          showToast(`"${doc.name}" deleted.`);
          loadAllData();
        } catch {}
      });
    }
    tbody.appendChild(tr);
  });
}

document.getElementById('lib-search').addEventListener('input', renderLibraryTable);
document.getElementById('lib-filter-project').addEventListener('change', renderLibraryTable);
document.getElementById('lib-filter-category').addEventListener('change', renderLibraryTable);

// ─── DOWNLOAD ────────────────────────────────────────────────────────────────
function downloadDoc(docId, docName) {
  showToast(`Preparing download for "${docName}"...`);
  fetch(`/api/download/${docId}`, {
    method: 'GET',
    headers: { 'x-auth-token': state.token }
  })
    .then(async res => {
      if (!res.ok) {
        let errMsg = 'Download failed.';
        try { const j = await res.json(); errMsg = j.error || errMsg; } catch(e) {}
        showToast(errMsg, 'error');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = docName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      // Small delay before cleanup to ensure browser processes the click
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 200);
      showToast(`"${docName}" downloaded successfully!`);
    })
    .catch(err => {
      console.error('Download error:', err);
      showToast('Download failed. Please try again.', 'error');
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════════════════

function renderAuditLogs() {
  const search = document.getElementById('audit-search')?.value?.toLowerCase().trim() || '';
  const logs = search
    ? state.auditLogs.filter(l => [l.action, l.details, l.username].some(v => v && v.toLowerCase().includes(search)))
    : state.auditLogs;

  const tbody = document.getElementById('audit-logs-tbody');
  tbody.innerHTML = '';

  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-secondary text-center" style="padding:40px">No logs found.</td></tr>';
    return;
  }

  logs.forEach(log => {
    const tr = document.createElement('tr');
    let badgeClass = 'badge-secondary';
    if (log.action.includes('UPLOAD')) badgeClass = 'badge-upload';
    else if (log.action.includes('CREATE') || log.action.includes('LOGIN')) badgeClass = 'badge-create';
    else if (log.action.includes('DELETE') || log.action.includes('LOGOUT')) badgeClass = 'badge-delete';
    else if (log.action.includes('UPDATE')) badgeClass = 'badge-update';
    else if (log.action.includes('DOWNLOAD')) badgeClass = 'badge-download';

    tr.innerHTML = `
      <td style="white-space:nowrap;color:var(--text-muted);font-size:.78rem">${formatDate(log.timestamp)}</td>
      <td><span class="user-chip">${escHtml(log.username || 'system')}</span></td>
      <td><span class="badge ${badgeClass}" style="font-size:.72rem">${escHtml(log.action)}</span></td>
      <td style="font-size:.83rem;color:var(--text-secondary)">${escHtml(log.details)}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('audit-search').addEventListener('input', renderAuditLogs);

// ═══════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

function renderUsersTable() {
  const isAdmin = state.currentUser?.role === 'admin';
  document.getElementById('users-table-wrap').classList.toggle('hidden', !isAdmin);
  document.getElementById('users-access-denied').classList.toggle('hidden', isAdmin);
  document.getElementById('btn-add-user').style.display = isAdmin ? '' : 'none';

  if (!isAdmin) return;

  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '';

  state.users.forEach(user => {
    const tr = document.createElement('tr');
    const roleClass = { admin: 'role-admin', editor: 'role-editor', viewer: 'role-viewer' }[user.role] || '';
    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="user-avatar-sm">${user.full_name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase()}</div>
          <div>
            <div style="font-weight:600;font-size:.88rem">${escHtml(user.full_name)}</div>
            <div style="color:var(--text-muted);font-size:.76rem">@${escHtml(user.username)}</div>
          </div>
        </div>
      </td>
      <td style="color:var(--text-secondary);font-size:.83rem">${escHtml(user.email)}</td>
      <td><span class="role-badge ${roleClass}">${escHtml(user.role)}</span></td>
      <td><span class="status-chip ${user.is_active ? 'active' : 'inactive'}">${user.is_active ? 'Active' : 'Inactive'}</span></td>
      <td style="color:var(--text-muted);font-size:.78rem">${formatDate(user.created_at)}</td>
      <td class="text-center">
        <div class="table-actions">
          <button class="doc-action-btn edit-user-btn" title="Edit User"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          ${user.id !== state.currentUser?.id ? `<button class="doc-action-btn delete delete-user-btn" title="Delete User"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>` : ''}
        </div>
      </td>
    `;

    tr.querySelector('.edit-user-btn').addEventListener('click', () => openUserModal(user));
    const delBtn = tr.querySelector('.delete-user-btn');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
        try {
          await apiRequest(`/api/users/${user.id}`, { method: 'DELETE' });
          showToast(`User "${user.username}" deleted.`);
          loadAllData();
        } catch {}
      });
    }
    tbody.appendChild(tr);
  });
}

// User Modal
function openUserModal(user = null) {
  const modal = document.getElementById('user-modal');
  const form = document.getElementById('user-form');
  const title = document.getElementById('user-modal-title');
  const statusGroup = document.getElementById('user-status-group');
  const pwdLabel = document.getElementById('pwd-req-label');
  const saveBtn = document.getElementById('btn-save-user');

  form.reset();
  document.getElementById('user-form-id').value = user ? user.id : '';

  if (user) {
    title.textContent = 'Edit User';
    saveBtn.textContent = 'Save Changes';
    document.getElementById('user-username').value = user.username;
    document.getElementById('user-username').disabled = true;
    document.getElementById('user-fullname').value = user.full_name;
    document.getElementById('user-email').value = user.email;
    document.getElementById('user-role').value = user.role;
    document.getElementById('user-active').value = user.is_active ? '1' : '0';
    statusGroup.style.display = '';
    pwdLabel.textContent = '(optional)';
    document.getElementById('user-password').placeholder = 'Leave blank to keep current';
  } else {
    title.textContent = 'Add New User';
    saveBtn.textContent = 'Create User';
    document.getElementById('user-username').disabled = false;
    statusGroup.style.display = 'none';
    pwdLabel.textContent = '*';
    document.getElementById('user-password').placeholder = 'Min. 6 characters';
  }

  modal.classList.remove('hidden');
}

document.getElementById('user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('user-form-id').value;
  const isEdit = !!id;

  const payload = {
    username: document.getElementById('user-username').value.trim(),
    full_name: document.getElementById('user-fullname').value.trim(),
    email: document.getElementById('user-email').value.trim(),
    role: document.getElementById('user-role').value,
    password: document.getElementById('user-password').value,
    is_active: document.getElementById('user-active').value === '1'
  };

  if (!isEdit && payload.password.length < 6) {
    showToast('Password must be at least 6 characters.', 'error'); return;
  }

  try {
    if (isEdit) {
      await apiRequest(`/api/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast('User updated successfully.');
    } else {
      await apiRequest('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast(`User "${payload.username}" created.`);
    }
    document.getElementById('user-modal').classList.add('hidden');
    loadAllData();
  } catch {}
});

document.getElementById('btn-add-user').addEventListener('click', () => openUserModal());
document.getElementById('user-modal-close').addEventListener('click', () => document.getElementById('user-modal').classList.add('hidden'));
document.getElementById('btn-cancel-user').addEventListener('click', () => document.getElementById('user-modal').classList.add('hidden'));

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENT MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function openDocModal(doc) {
  const isEditor = ['admin', 'editor'].includes(state.currentUser?.role);
  document.getElementById('edit-doc-id').value = doc.id;
  document.getElementById('doc-modal-title').textContent = doc.name;
  document.getElementById('doc-meta-name').textContent = doc.name;
  document.getElementById('doc-meta-location').textContent = `${doc.project_name} / ${doc.folder_name}`;
  document.getElementById('doc-meta-version').textContent = doc.version;
  document.getElementById('doc-meta-size').textContent = formatBytes(doc.size);
  document.getElementById('doc-meta-uploader').textContent = doc.uploaded_by_name || '—';
  document.getElementById('doc-meta-date').textContent = formatDate(doc.created_at);
  document.getElementById('edit-category').value = doc.category || 'Technical';
  document.getElementById('edit-tags').value = doc.tags || '';
  document.getElementById('edit-description').value = doc.description || '';

  // Wire up Open in New Tab button in modal header
  const openNewTabBtn = document.getElementById('btn-open-newtab-modal');
  if (openNewTabBtn) {
    openNewTabBtn.onclick = () => {
      window.open(`/viewer/${doc.id}?token=${encodeURIComponent(state.token)}`, '_blank');
    };
  }

  // Wire up Download button in modal header
  const downloadModalBtn = document.getElementById('btn-download-modal');
  if (downloadModalBtn) {
    downloadModalBtn.onclick = () => downloadDoc(doc.id, doc.name);
  }

  // Render Preview
  renderDocPreview(doc);

  // Read-only for viewers
  ['edit-category', 'edit-tags', 'edit-description'].forEach(id => {
    document.getElementById(id).disabled = !isEditor;
  });
  document.getElementById('doc-modal-actions').style.display = isEditor ? '' : 'none';

  const deleteBtn = document.getElementById('btn-delete-doc-modal');
  if (deleteBtn) {
    deleteBtn.style.display = isEditor ? '' : 'none';
    deleteBtn.onclick = async () => {
      if (!confirm(`Delete "${doc.name}"?`)) return;
      try {
        await apiRequest(`/api/documents/${doc.id}`, { method: 'DELETE' });
        document.getElementById('doc-modal').classList.add('hidden');
        showToast(`"${doc.name}" deleted.`);
        loadAllData();
      } catch {}
    };
  }

  document.getElementById('doc-modal').classList.remove('hidden');
}

function renderDocPreview(doc) {
  const previewBody = document.getElementById('doc-preview-body');
  previewBody.innerHTML = '<div class="preview-placeholder">Loading preview...</div>';

  const ext = doc.name.split('.').pop().toLowerCase();
  const fileUrl    = `/api/view/${doc.id}?token=${encodeURIComponent(state.token)}`;
  const viewerUrl  = `/viewer/${doc.id}?token=${encodeURIComponent(state.token)}`;

  if (ext === 'pdf') {
    // Embed PDF via object; fallback guides user to the viewer page
    previewBody.innerHTML = `
      <object class="preview-iframe" data="${fileUrl}" type="application/pdf" style="width:100%;height:100%;border:none;">
        <div class="preview-fallback-card">
          <svg class="preview-fallback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:#e74c3c"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
          <div class="preview-fallback-text">PDF preview not available in this browser.<br><strong>Use the Open or Download buttons above.</strong></div>
          <button type="button" class="btn btn-primary btn-sm" onclick="window.open('${viewerUrl}', '_blank')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:6px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Open PDF in New Tab
          </button>
        </div>
      </object>
    `;
  } else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
    previewBody.innerHTML = `<img class="preview-img" src="${fileUrl}" alt="${escHtml(doc.name)}">`;
  } else if (['txt', 'json', 'js', 'css', 'html', 'md', 'xml', 'csv'].includes(ext)) {
    fetch(fileUrl)
      .then(res => {
        if (!res.ok) throw new Error();
        return res.text();
      })
      .then(text => {
        previewBody.innerHTML = `<pre class="preview-text">${escHtml(text)}</pre>`;
      })
      .catch(() => {
        previewBody.innerHTML = '<div class="preview-placeholder text-danger">Error loading file content.</div>';
      });
  } else {
    let iconSvg = '<svg class="preview-fallback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    if (['doc', 'docx'].includes(ext)) {
      iconSvg = '<svg class="preview-fallback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--color-primary)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h2"/></svg>';
    } else if (['xls', 'xlsx'].includes(ext)) {
      iconSvg = '<svg class="preview-fallback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--color-success)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 10h8"/><path d="M8 14h8"/><path d="M8 18h8"/></svg>';
    }
    
    previewBody.innerHTML = `
      <div class="preview-fallback-card">
        ${iconSvg}
        <div class="preview-fallback-text">No in-app preview available for <strong>.${ext.toUpperCase()}</strong> files.</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="downloadDoc(${doc.id}, '${escHtml(doc.name).replace(/'/g, "\\'")}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download to View
        </button>
      </div>
    `;
  }
}

document.getElementById('edit-doc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('edit-doc-id').value;
  try {
    await apiRequest(`/api/documents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: document.getElementById('edit-category').value,
        tags: document.getElementById('edit-tags').value.trim(),
        description: document.getElementById('edit-description').value.trim()
      })
    });
    document.getElementById('doc-modal').classList.add('hidden');
    showToast('Document metadata updated.');
    loadAllData();
  } catch {}
});

document.getElementById('doc-modal-close').addEventListener('click', () => document.getElementById('doc-modal').classList.add('hidden'));
document.getElementById('btn-cancel-edit').addEventListener('click', () => document.getElementById('doc-modal').classList.add('hidden'));

// ═══════════════════════════════════════════════════════════════════════════════
// PROJECT MODAL
// ═══════════════════════════════════════════════════════════════════════════════

document.getElementById('btn-add-project').addEventListener('click', () => {
  document.getElementById('new-project-name').value = '';
  document.getElementById('new-project-desc').value = '';
  document.getElementById('project-modal').classList.remove('hidden');
});

document.getElementById('add-project-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const name = document.getElementById('new-project-name').value.trim();
    const description = document.getElementById('new-project-desc').value.trim();
    await apiRequest('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });
    document.getElementById('project-modal').classList.add('hidden');
    showToast(`Project "${name}" created.`);
    loadAllData();
  } catch {}
});

document.getElementById('project-modal-close').addEventListener('click', () => document.getElementById('project-modal').classList.add('hidden'));
document.getElementById('btn-cancel-project').addEventListener('click', () => document.getElementById('project-modal').classList.add('hidden'));

// ═══════════════════════════════════════════════════════════════════════════════
// FOLDER MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function openFolderModal(projectId, parentId, projectName) {
  document.getElementById('folder-project-id').value = projectId;
  document.getElementById('folder-parent-id').value = parentId || '';
  document.getElementById('folder-project-name').textContent = projectName;
  document.getElementById('new-folder-name').value = '';
  document.getElementById('folder-modal').classList.remove('hidden');
}

document.getElementById('btn-add-folder').addEventListener('click', () => {
  if (!state.selectedProjectId) return;
  const project = state.projects.find(p => p.id === state.selectedProjectId);
  openFolderModal(state.selectedProjectId, state.selectedFolderId, project?.name);
});

document.getElementById('add-folder-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const project_id = document.getElementById('folder-project-id').value;
    const parent_folder_id = document.getElementById('folder-parent-id').value || null;
    const name = document.getElementById('new-folder-name').value.trim();
    await apiRequest('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id, parent_folder_id, name })
    });
    document.getElementById('folder-modal').classList.add('hidden');
    showToast(`Folder "${name}" created.`);
    loadAllData();
  } catch {}
});

document.getElementById('folder-modal-close').addEventListener('click', () => document.getElementById('folder-modal').classList.add('hidden'));
document.getElementById('btn-cancel-folder').addEventListener('click', () => document.getElementById('folder-modal').classList.add('hidden'));

// ═══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
});

const TAB_META = {
  explorer: { title: 'Project Explorer', sub: 'Browse, manage and organize all documents by project' },
  upload:   { title: 'Upload Document', sub: 'Import files, assign metadata and track versions' },
  library:  { title: 'Document Library', sub: 'Search, filter and manage all uploaded documents' },
  users:    { title: 'User Management', sub: 'Manage user accounts and access permissions' },
  audit:    { title: 'Audit Log', sub: 'Full history of all system operations and user actions' }
};

function switchTab(tabName) {
  state.activeTab = tabName;

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(s => {
    s.classList.toggle('active', s.id === `content-${tabName}`);
  });

  const meta = TAB_META[tabName] || {};
  document.getElementById('page-title').textContent = meta.title || '';
  document.getElementById('page-subtitle').textContent = meta.sub || '';

  if (tabName === 'library') renderLibraryTable();
  else if (tabName === 'audit') renderAuditLogs();
  else if (tabName === 'users') renderUsersTable();
}

// Upload Here from Explorer
document.getElementById('btn-upload-direct').addEventListener('click', () => {
  if (!state.selectedProjectId || !state.selectedFolderId) return;
  document.getElementById('upload-project').value = state.selectedProjectId;
  document.getElementById('upload-project').dispatchEvent(new Event('change'));
  setTimeout(() => { document.getElementById('upload-folder').value = state.selectedFolderId; }, 50);
  switchTab('upload');
});

// ═══════════════════════════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════════════════════════

document.getElementById('theme-toggle').addEventListener('click', () => {
  const isDark = document.body.classList.contains('dark-theme');
  document.body.classList.toggle('dark-theme', !isDark);
  document.body.classList.toggle('light-theme', isDark);
  state.theme = isDark ? 'light' : 'dark';
  localStorage.setItem('theme', state.theme);
});

function applyTheme() {
  document.body.classList.toggle('dark-theme', state.theme === 'dark');
  document.body.classList.toggle('light-theme', state.theme === 'light');
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLOSE MODALS ON OVERLAY CLICK
// ═══════════════════════════════════════════════════════════════════════════════

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
});

// ─── ESCAPE KEY ───────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
});

// ─── SECURITY HELPER ─────────────────────────────────────────────────────────
function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════
applyTheme();
checkExistingSession();
