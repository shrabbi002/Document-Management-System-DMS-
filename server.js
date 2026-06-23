const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mammoth = require('mammoth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Database
const dbPath = path.join(__dirname, 'dms.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening DB:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
    db.run('PRAGMA foreign_keys = ON');
    initializeDatabase();
  }
});

// Promise helpers
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve({ id: this.lastID, changes: this.changes });
  });
});
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
});
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
});

// ─── DB INIT ─────────────────────────────────────────────────────────────────
async function initializeDatabase() {
  try {
    // Users
    await dbRun(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Sessions (simple token table)
    await dbRun(`CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Projects
    await dbRun(`CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`);

    // Folders
    await dbRun(`CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      parent_folder_id INTEGER,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_folder_id) REFERENCES folders(id) ON DELETE CASCADE,
      UNIQUE(project_id, name, parent_folder_id)
    )`);

    // Documents
    await dbRun(`CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      tags TEXT,
      description TEXT,
      version TEXT NOT NULL,
      file_path TEXT NOT NULL,
      size INTEGER NOT NULL,
      uploaded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )`);

    // Audit Logs
    await dbRun(`CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      details TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Seed admin user if no users exist
    const userCount = await dbGet('SELECT COUNT(*) as count FROM users');
    if (userCount.count === 0) {
      console.log('Seeding initial data...');
      const adminHash = await bcrypt.hash('admin123', 10);
      const viewerHash = await bcrypt.hash('viewer123', 10);
      const editorHash = await bcrypt.hash('editor123', 10);

      const adminId = (await dbRun(
        'INSERT INTO users (username, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        ['admin', 'System Administrator', 'admin@aerodms.com', adminHash, 'admin']
      )).id;

      await dbRun(
        'INSERT INTO users (username, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        ['editor1', 'John Editor', 'editor@aerodms.com', editorHash, 'editor']
      );
      await dbRun(
        'INSERT INTO users (username, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        ['viewer1', 'Jane Viewer', 'viewer@aerodms.com', viewerHash, 'viewer']
      );

      // Seed projects & folders
      const joclId = (await dbRun('INSERT INTO projects (name, description, created_by) VALUES (?, ?, ?)',
        ['JOCL', 'Joint Operations Command Logistics', adminId])).id;
      const bcslId = (await dbRun('INSERT INTO projects (name, description, created_by) VALUES (?, ?, ?)',
        ['BCSL', 'Base Command Supply Logistics', adminId])).id;
      const armyId = (await dbRun('INSERT INTO projects (name, description, created_by) VALUES (?, ?, ?)',
        ['Army Inventory', 'Army Inventory Management System', adminId])).id;

      await dbRun('INSERT INTO folders (project_id, name, created_by) VALUES (?, ?, ?)', [joclId, 'SRS', adminId]);
      await dbRun('INSERT INTO folders (project_id, name, created_by) VALUES (?, ?, ?)', [joclId, 'Design', adminId]);
      await dbRun('INSERT INTO folders (project_id, name, created_by) VALUES (?, ?, ?)', [joclId, 'Development', adminId]);
      await dbRun('INSERT INTO folders (project_id, name, created_by) VALUES (?, ?, ?)', [joclId, 'Testing', adminId]);
      await dbRun('INSERT INTO folders (project_id, name, created_by) VALUES (?, ?, ?)', [joclId, 'Deliverables', adminId]);
      await dbRun('INSERT INTO folders (project_id, name, created_by) VALUES (?, ?, ?)', [bcslId, 'Requirements', adminId]);
      await dbRun('INSERT INTO folders (project_id, name, created_by) VALUES (?, ?, ?)', [bcslId, 'Contracts', adminId]);
      await dbRun('INSERT INTO folders (project_id, name, created_by) VALUES (?, ?, ?)', [armyId, 'Inventory Lists', adminId]);
      await dbRun('INSERT INTO folders (project_id, name, created_by) VALUES (?, ?, ?)', [armyId, 'SOP Docs', adminId]);

      await dbRun('INSERT INTO audit_logs (username, action, details) VALUES (?, ?, ?)',
        ['system', 'SYSTEM_INIT', 'Database initialized and seeded with default data.']);

      console.log('Database seeded. Default credentials: admin/admin123, editor1/editor123, viewer1/viewer123');
    }
  } catch (error) {
    console.error('DB Init error:', error);
  }
}

// ─── AUTH MIDDLEWARE ─────────────────────────────────────────────────────────
async function authenticate(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'No token provided. Please log in.' });

  try {
    const session = await dbGet(
      'SELECT s.*, u.id as uid, u.username, u.full_name, u.role, u.is_active FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?',
      [token]
    );
    if (!session) return res.status(401).json({ error: 'Invalid or expired session.' });
    if (!session.is_active) return res.status(403).json({ error: 'Account is deactivated.' });
    req.user = { id: session.uid, username: session.username, full_name: session.full_name, role: session.role };
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied. Required role: ${roles.join(' or ')}` });
    }
    next();
  };
}

// ─── AUDIT LOG HELPER ────────────────────────────────────────────────────────
async function logAction(userId, username, action, details) {
  try {
    await dbRun('INSERT INTO audit_logs (user_id, username, action, details) VALUES (?, ?, ?, ?)',
      [userId || null, username || 'system', action, details]);
  } catch (err) {
    console.error('Audit log failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });

  try {
    const user = await dbGet('SELECT * FROM users WHERE username = ? AND is_active = 1', [username.trim()]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

    // Generate session token
    const token = crypto.randomBytes(32).toString('hex');
    await dbRun('INSERT INTO sessions (user_id, token) VALUES (?, ?)', [user.id, token]);

    // Clean old sessions for this user (keep only last 5)
    await dbRun(`DELETE FROM sessions WHERE user_id = ? AND id NOT IN (
      SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
    )`, [user.id, user.id]);

    await logAction(user.id, user.username, 'USER_LOGIN', `User "${user.username}" logged in.`);

    res.json({
      token,
      user: { id: user.id, username: user.username, full_name: user.full_name, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', authenticate, async (req, res) => {
  const token = req.headers['x-auth-token'];
  try {
    await dbRun('DELETE FROM sessions WHERE token = ?', [token]);
    await logAction(req.user.id, req.user.username, 'USER_LOGOUT', `User "${req.user.username}" logged out.`);
    res.json({ message: 'Logged out successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', authenticate, (req, res) => {
  res.json(req.user);
});

// ═══════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT (Admin only)
// ═══════════════════════════════════════════════════════════════════════════════

// GET all users
app.get('/api/users', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const users = await dbAll('SELECT id, username, full_name, email, role, is_active, created_at FROM users ORDER BY created_at DESC');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create user
app.post('/api/users', authenticate, requireRole('admin'), async (req, res) => {
  const { username, full_name, email, password, role } = req.body;
  if (!username || !full_name || !email || !password) return res.status(400).json({ error: 'All fields are required.' });

  const validRoles = ['admin', 'editor', 'viewer'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role.' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await dbRun(
      'INSERT INTO users (username, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [username.trim(), full_name.trim(), email.trim(), hash, role]
    );
    await logAction(req.user.id, req.user.username, 'USER_CREATE', `Created user "${username}" with role "${role}".`);
    res.status(201).json({ id: result.id, username, full_name, email, role, is_active: 1 });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username or email already exists.' });
    res.status(500).json({ error: err.message });
  }
});

// PUT update user
app.put('/api/users/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { full_name, email, role, is_active, password } = req.body;

  try {
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (password && password.length >= 6) {
      const hash = await bcrypt.hash(password, 10);
      await dbRun('UPDATE users SET full_name=?, email=?, role=?, is_active=?, password_hash=? WHERE id=?',
        [full_name, email, role, is_active ? 1 : 0, hash, id]);
    } else {
      await dbRun('UPDATE users SET full_name=?, email=?, role=?, is_active=? WHERE id=?',
        [full_name, email, role, is_active ? 1 : 0, id]);
    }

    await logAction(req.user.id, req.user.username, 'USER_UPDATE', `Updated user "${user.username}".`);
    res.json({ message: 'User updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE user
app.delete('/api/users/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account.' });

  try {
    const user = await dbGet('SELECT username FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    await dbRun('DELETE FROM users WHERE id = ?', [id]);
    await logAction(req.user.id, req.user.username, 'USER_DELETE', `Deleted user "${user.username}".`);
    res.json({ message: 'User deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROJECTS API
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/projects', authenticate, async (req, res) => {
  try {
    const projects = await dbAll(`
      SELECT p.*, u.username as created_by_name,
        (SELECT COUNT(*) FROM folders f WHERE f.project_id = p.id) as folder_count,
        (SELECT COUNT(*) FROM documents d JOIN folders f ON d.folder_id = f.id WHERE f.project_id = p.id) as doc_count
      FROM projects p LEFT JOIN users u ON p.created_by = u.id ORDER BY p.name ASC
    `);
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', authenticate, requireRole('admin', 'editor'), async (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Project name is required.' });
  try {
    const result = await dbRun('INSERT INTO projects (name, description, created_by) VALUES (?, ?, ?)',
      [name.trim(), description || '', req.user.id]);
    await logAction(req.user.id, req.user.username, 'PROJECT_CREATE', `Created project "${name.trim()}".`);
    res.status(201).json({ id: result.id, name: name.trim(), description: description || '' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Project name already exists.' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', authenticate, requireRole('admin', 'editor'), async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  try {
    const project = await dbGet('SELECT * FROM projects WHERE id = ?', [id]);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    await dbRun('UPDATE projects SET name = ?, description = ? WHERE id = ?', [name.trim(), description || '', id]);
    await logAction(req.user.id, req.user.username, 'PROJECT_UPDATE', `Updated project "${project.name}".`);
    res.json({ message: 'Project updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const project = await dbGet('SELECT name FROM projects WHERE id = ?', [id]);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const docs = await dbAll('SELECT file_path FROM documents d JOIN folders f ON d.folder_id = f.id WHERE f.project_id = ?', [id]);
    docs.forEach(doc => {
      const fp = path.join(uploadsDir, doc.file_path);
      try {
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch (fileErr) {
        console.warn(`Could not delete file from disk during project delete: ${fp}. Error: ${fileErr.message}`);
      }
    });
    await dbRun('DELETE FROM projects WHERE id = ?', [id]);
    await logAction(req.user.id, req.user.username, 'PROJECT_DELETE', `Deleted project "${project.name}".`);
    res.json({ message: 'Project deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FOLDERS API
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/folders', authenticate, async (req, res) => {
  try {
    const folders = await dbAll('SELECT * FROM folders ORDER BY name ASC');
    res.json(folders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/folders', authenticate, requireRole('admin', 'editor'), async (req, res) => {
  const { project_id, name, parent_folder_id } = req.body;
  if (!project_id || !name || !name.trim()) return res.status(400).json({ error: 'Project ID and folder name required.' });
  try {
    const project = await dbGet('SELECT name FROM projects WHERE id = ?', [project_id]);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const result = await dbRun(
      'INSERT INTO folders (project_id, name, parent_folder_id, created_by) VALUES (?, ?, ?, ?)',
      [project_id, name.trim(), parent_folder_id || null, req.user.id]
    );
    await logAction(req.user.id, req.user.username, 'FOLDER_CREATE', `Created folder "${name.trim()}" in "${project.name}".`);
    res.status(201).json({ id: result.id, name: name.trim(), project_id, parent_folder_id: parent_folder_id || null });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Folder name already exists at this level.' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/folders/:id', authenticate, requireRole('admin', 'editor'), async (req, res) => {
  const { id } = req.params;
  try {
    const folder = await dbGet('SELECT f.name, p.name as project_name FROM folders f JOIN projects p ON f.project_id = p.id WHERE f.id = ?', [id]);
    if (!folder) return res.status(404).json({ error: 'Folder not found.' });
    const docs = await dbAll('SELECT file_path FROM documents WHERE folder_id = ?', [id]);
    docs.forEach(doc => {
      const fp = path.join(uploadsDir, doc.file_path);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });
    await dbRun('DELETE FROM folders WHERE id = ?', [id]);
    await logAction(req.user.id, req.user.username, 'FOLDER_DELETE', `Deleted folder "${folder.name}" from "${folder.project_name}".`);
    res.json({ message: 'Folder deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENTS API
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/documents', authenticate, async (req, res) => {
  try {
    const docs = await dbAll(`
      SELECT d.*, f.name as folder_name, p.name as project_name, p.id as project_id, u.username as uploaded_by_name
      FROM documents d
      JOIN folders f ON d.folder_id = f.id
      JOIN projects p ON f.project_id = p.id
      LEFT JOIN users u ON d.uploaded_by = u.id
      ORDER BY d.created_at DESC
    `);
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload document
app.post('/api/upload', authenticate, requireRole('admin', 'editor'), upload.single('file'), async (req, res) => {
  const { folder_id, category, tags, description } = req.body;
  const file = req.file;
  if (!folder_id) return res.status(400).json({ error: 'Folder ID is required.' });
  if (!file) return res.status(400).json({ error: 'No file uploaded.' });

  try {
    const folder = await dbGet(
      'SELECT f.name as folder_name, p.name as project_name FROM folders f JOIN projects p ON f.project_id = p.id WHERE f.id = ?',
      [folder_id]
    );
    if (!folder) return res.status(404).json({ error: 'Folder not found.' });

    // Version detection
    const existingDoc = await dbGet(
      'SELECT version FROM documents WHERE folder_id = ? AND name = ? ORDER BY created_at DESC LIMIT 1',
      [folder_id, file.originalname]
    );
    let nextVersion = 'v1.0.0';
    if (existingDoc) {
      const match = existingDoc.version.match(/^v(\d+)\.(\d+)\.(\d+)$/);
      if (match) nextVersion = `v${match[1]}.${match[2]}.${parseInt(match[3]) + 1}`;
      else nextVersion = existingDoc.version + '.1';
    }

    const result = await dbRun(
      'INSERT INTO documents (folder_id, name, category, tags, description, version, file_path, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [folder_id, file.originalname, category || 'Uncategorized', tags || '', description || '', nextVersion, file.filename, file.size, req.user.id]
    );

    await logAction(req.user.id, req.user.username, 'DOCUMENT_UPLOAD',
      `Uploaded "${file.originalname}" (${nextVersion}) to ${folder.project_name}/${folder.folder_name}.`);

    res.status(201).json({
      id: result.id, folder_id, name: file.originalname,
      category: category || 'Uncategorized', tags: tags || '',
      description: description || '', version: nextVersion,
      file_path: file.filename, size: file.size
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update document metadata
app.put('/api/documents/:id', authenticate, requireRole('admin', 'editor'), async (req, res) => {
  const { id } = req.params;
  const { category, tags, description } = req.body;
  try {
    const doc = await dbGet('SELECT name, version FROM documents WHERE id = ?', [id]);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    await dbRun('UPDATE documents SET category = ?, tags = ?, description = ? WHERE id = ?', [category, tags, description, id]);
    await logAction(req.user.id, req.user.username, 'DOCUMENT_UPDATE', `Updated metadata of "${doc.name}" (${doc.version}).`);
    res.json({ message: 'Document updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete document
app.delete('/api/documents/:id', authenticate, requireRole('admin', 'editor'), async (req, res) => {
  const { id } = req.params;
  try {
    const doc = await dbGet('SELECT name, version, file_path FROM documents WHERE id = ?', [id]);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    const fp = path.join(uploadsDir, doc.file_path);
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (fileErr) {
      console.warn(`Could not delete file from disk: ${fp}. Error: ${fileErr.message}`);
    }
    await dbRun('DELETE FROM documents WHERE id = ?', [id]);
    await logAction(req.user.id, req.user.username, 'DOCUMENT_DELETE', `Deleted "${doc.name}" (${doc.version}).`);
    res.json({ message: 'Document deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download document
app.get('/api/download/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const doc = await dbGet('SELECT name, file_path FROM documents WHERE id = ?', [id]);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    const fp = path.join(uploadsDir, doc.file_path);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found on disk.' });

    // Set Content-Disposition with proper filename encoding
    const encodedName = encodeURIComponent(doc.name).replace(/'/g, "%27");
    res.setHeader('Content-Disposition', `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
    res.setHeader('Cache-Control', 'no-cache');

    res.download(fp, doc.name, async (err) => {
      if (err && !res.headersSent) {
        console.error('Download error:', err);
        res.status(500).json({ error: 'Download failed.' });
      } else if (!err) {
        await logAction(req.user.id, req.user.username, 'DOCUMENT_DOWNLOAD', `Downloaded "${doc.name}".`);
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HTML VIEWER PAGE (opens in new tab, file content embedded as data URI) ──
app.get('/viewer/:id', async (req, res) => {
  const { id } = req.params;

  // Inline auth — always respond with HTML so the browser never downloads a file
  const token = req.headers['x-auth-token'] || req.query.token;
  if (!token) {
    return res.status(401).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Login Required — AeroDMS</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0d0d1a;font-family:'Segoe UI',sans-serif;color:#ccc}.box{text-align:center;padding:40px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:16px}h2{color:#7c6fff;margin-bottom:12px}a{color:#7c6fff;font-weight:600}</style></head><body><div class="box"><h2>Login Required</h2><p>Your session has expired or is invalid.</p><br><a href="/">← Back to AeroDMS Login</a></div></body></html>`);
  }

  const session = await dbGet(
    'SELECT s.*, u.id as uid, u.username, u.full_name, u.role, u.is_active FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?',
    [token]
  ).catch(() => null);
  if (!session || !session.is_active) {
    return res.status(401).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Session Expired — AeroDMS</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0d0d1a;font-family:'Segoe UI',sans-serif;color:#ccc}.box{text-align:center;padding:40px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:16px}h2{color:#7c6fff;margin-bottom:12px}a{color:#7c6fff;font-weight:600}</style></head><body><div class="box"><h2>Session Expired</h2><p>Please log in again to view this document.</p><br><a href="/">← Back to AeroDMS</a></div></body></html>`);
  }

  try {
    const doc = await dbGet('SELECT id, name, file_path FROM documents WHERE id = ?', [id]);
    if (!doc) return res.status(404).send('<h2>Document not found.</h2>');

    const fp = path.join(uploadsDir, doc.file_path);
    if (!fs.existsSync(fp)) return res.status(404).send('<h2>File not found on disk.</h2>');

    const ext = path.extname(doc.name).toLowerCase();
    const safeDocName = doc.name.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const encodedToken = encodeURIComponent(token);
    const downloadUrl = `/api/download/${id}?token=${encodedToken}`;

    // ── Determine MIME type ────────────────────────────────────────────────────
    const MIME = {
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.txt': 'text/plain',
      '.md': 'text/plain',
      '.json': 'application/json',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.xml': 'application/xml',
      '.csv': 'text/csv',
    };
    const mimeType = MIME[ext] || null;

    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'].includes(ext);
    const isPdf = ext === '.pdf';
    const isText = ['.txt', '.md', '.json', '.js', '.css', '.xml', '.csv', '.html', '.htm'].includes(ext);
    const isDocx = ext === '.docx';

    // ── Build the viewer body ──────────────────────────────────────────────────
    let viewerBody = '';

    if (isPdf) {
      // Read PDF bytes and embed as base64 data URI — browser renders inline
      const fileBytes = fs.readFileSync(fp);
      const b64 = fileBytes.toString('base64');
      const dataUri = `data:application/pdf;base64,${b64}`;
      viewerBody = `
        <embed
          src="${dataUri}"
          type="application/pdf"
          style="width:100%;height:100%;border:none;display:block;"
          title="${safeDocName}">
        </embed>`;

    } else if (isImage) {
      // Embed image as base64 data URI
      const fileBytes = fs.readFileSync(fp);
      const b64 = fileBytes.toString('base64');
      const dataUri = `data:${mimeType};base64,${b64}`;
      viewerBody = `
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#111;overflow:auto;padding:20px;box-sizing:border-box;">
          <img src="${dataUri}" alt="${safeDocName}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,.5);">
        </div>`;

    } else if (isText) {
      // Read text content and display in a styled <pre> block
      let textContent = '';
      try { textContent = fs.readFileSync(fp, 'utf8'); } catch (e) { textContent = '[Could not read file]'; }
      const safeText = textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      viewerBody = `
        <div style="width:100%;height:100%;overflow:auto;padding:24px 32px;box-sizing:border-box;background:#0d0d1a;">
          <pre style="margin:0;font-family:'Fira Mono','Cascadia Code','Consolas',monospace;font-size:.88rem;line-height:1.65;color:#d4d4d4;white-space:pre-wrap;word-break:break-word;">${safeText}</pre>
        </div>`;

    } else if (isDocx) {
      // Convert Word document to HTML using mammoth
      try {
        const result = await mammoth.convertToHtml({ path: fp });
        const docxHtml = result.value || '<p><em>Empty Document</em></p>';
        viewerBody = `
          <div class="docx-viewer">
            <div class="docx-page">
              ${docxHtml}
            </div>
          </div>`;
      } catch (err) {
        viewerBody = `
          <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;color:#ff5a5a;font-family:sans-serif;text-align:center;padding:40px;box-sizing:border-box;">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <div style="font-size:1.1rem;font-weight:600;">Error converting Word document</div>
            <div style="font-size:.9rem;color:#888;">${err.message}</div>
          </div>`;
      }

    } else {
      // Unsupported type — show a download card
      viewerBody = `
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:18px;color:#ccc;font-family:sans-serif;text-align:center;padding:40px;box-sizing:border-box;">
          <svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="#7c6fff" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <div style="font-size:1.1rem;font-weight:600;color:#fff;">${safeDocName}</div>
          <div style="font-size:.9rem;color:#888;">In-browser preview is not available for <strong style="color:#aaa;">${ext.toUpperCase()}</strong> files.</div>
          <a href="${downloadUrl}" download="${safeDocName}" style="margin-top:10px;padding:12px 28px;background:#7c6fff;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:.9rem;display:inline-flex;align-items:center;gap:8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download File
          </a>
        </div>`;
    }

    // Log the view action
    await logAction(session.uid, session.username, 'DOCUMENT_VIEW', `Viewed "${doc.name}".`).catch(() => { });

    // ── Assemble full HTML page ────────────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeDocName} — AeroDMS Viewer</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #0d0d1a; font-family: 'Segoe UI', system-ui, sans-serif; }
    .viewer-bar {
      position: fixed; top: 0; left: 0; right: 0; height: 52px; z-index: 100;
      background: rgba(13,13,26,0.97); backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 20px; gap: 14px;
    }
    .viewer-brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .viewer-brand svg { color: #7c6fff; }
    .viewer-brand span { font-size: .8rem; font-weight: 700; color: #7c6fff; letter-spacing: 1px; text-transform: uppercase; }
    .viewer-title { flex: 1; font-size: .9rem; font-weight: 600; color: #e0e0f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .viewer-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .viewer-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 16px; border-radius: 7px; font-size: .8rem; font-weight: 600;
      cursor: pointer; text-decoration: none; border: none; transition: filter .15s, background .15s;
    }
    .viewer-btn-outline { background: transparent; border: 1px solid rgba(255,255,255,0.15); color: #ccc; }
    .viewer-btn-outline:hover { background: rgba(255,255,255,0.08); color: #fff; }
    .viewer-btn-primary { background: #7c6fff; color: #fff; }
    .viewer-btn-primary:hover { filter: brightness(1.15); }
    .viewer-content { position: fixed; top: 52px; left: 0; right: 0; bottom: 0; overflow: hidden; }
    .docx-viewer {
      width: 100%;
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      background: #09090e;
      padding: 40px 20px;
      box-sizing: border-box;
    }
    .docx-page {
      width: 100%;
      max-width: 850px;
      margin: 0 auto;
      background: #ffffff;
      color: #2b2b2b;
      padding: 60px 80px;
      border-radius: 8px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.5);
      font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
      line-height: 1.6;
      font-size: 1.1rem;
      box-sizing: border-box;
    }
    .docx-page h1, .docx-page h2, .docx-page h3, .docx-page h4 {
      color: #111;
      margin-top: 1.4em;
      margin-bottom: 0.6em;
      font-weight: 700;
      line-height: 1.25;
    }
    .docx-page h1 { font-size: 1.8rem; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
    .docx-page h2 { font-size: 1.4rem; }
    .docx-page h3 { font-size: 1.2rem; }
    .docx-page p {
      margin-bottom: 1.1em;
    }
    .docx-page table {
      width: 100% !important;
      border-collapse: collapse;
      margin: 2em 0;
      font-size: 0.95rem;
    }
    .docx-page th, .docx-page td {
      border: 1px solid #ddd;
      padding: 10px 14px;
      text-align: left;
    }
    .docx-page th {
      background-color: #f7f7f7;
      font-weight: 700;
    }
    .docx-page ul, .docx-page ol {
      margin-left: 2em;
      margin-bottom: 1.1em;
    }
    .docx-page li {
      margin-bottom: 0.4em;
    }
  </style>
</head>
<body>
  <div class="viewer-bar">
    <div class="viewer-brand">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      <span>AeroDMS</span>
    </div>
    <div class="viewer-title" title="${safeDocName}">${safeDocName}</div>
    <div class="viewer-actions">
      <button class="viewer-btn viewer-btn-outline" onclick="window.print()" title="Print">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        Print
      </button>
      <a href="${downloadUrl}" download="${safeDocName}" class="viewer-btn viewer-btn-primary">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download
      </a>
    </div>
  </div>
  <div class="viewer-content">
    ${viewerBody}
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);

  } catch (err) {
    res.status(500).send('Viewer error: ' + err.message);
  }
});

// View document inline (raw file — used for iframe embeds inside the app)
app.get('/api/view/:id', async (req, res) => {
  const { id } = req.params;
  const token = req.headers['x-auth-token'] || req.query.token;
  if (!token) return res.status(401).send('Unauthorized');
  const session = await dbGet(
    'SELECT s.*, u.id as uid, u.username, u.full_name, u.role, u.is_active FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?',
    [token]
  ).catch(() => null);
  if (!session || !session.is_active) return res.status(401).send('Unauthorized');
  const user = { id: session.uid, username: session.username, full_name: session.full_name, role: session.role };
  try {
    const doc = await dbGet('SELECT name, file_path FROM documents WHERE id = ?', [id]);
    if (!doc) return res.status(404).send('Document not found.');
    const fp = path.join(uploadsDir, doc.file_path);
    if (!fs.existsSync(fp)) return res.status(404).send('File not found on disk.');

    const ext = path.extname(doc.name).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === '.pdf') mimeType = 'application/pdf';
    else if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.gif') mimeType = 'image/gif';
    else if (ext === '.svg') mimeType = 'image/svg+xml';
    else if (ext === '.txt') mimeType = 'text/plain; charset=utf-8';
    else if (ext === '.json') mimeType = 'application/json; charset=utf-8';
    else if (ext === '.html' || ext === '.htm') mimeType = 'text/html; charset=utf-8';
    else if (ext === '.css') mimeType = 'text/css; charset=utf-8';
    else if (ext === '.js') mimeType = 'application/javascript; charset=utf-8';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=300');
    await logAction(user.id, user.username, 'DOCUMENT_VIEW', `Viewed "${doc.name}".`);
    res.sendFile(fp);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/logs', authenticate, async (req, res) => {
  try {
    const logs = await dbAll('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 500');
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/stats', authenticate, async (req, res) => {
  try {
    const [projects, docs, users, logs, storage] = await Promise.all([
      dbGet('SELECT COUNT(*) as count FROM projects'),
      dbGet('SELECT COUNT(*) as count FROM documents'),
      dbGet('SELECT COUNT(*) as count FROM users WHERE is_active = 1'),
      dbGet('SELECT COUNT(*) as count FROM audit_logs'),
      dbGet('SELECT COALESCE(SUM(size), 0) as total FROM documents')
    ]);
    res.json({
      projects: projects.count,
      documents: docs.count,
      users: users.count,
      logs: logs.count,
      storage: storage.total
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SPA catch-all (serve index.html for any unmatched route) ─────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const nets = os.networkInterfaces();
  let localIp = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) { localIp = net.address; break; }
    }
  }
  console.log(`\n🚀 AeroDMS server is running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://${localIp}:${PORT}\n`);
});
