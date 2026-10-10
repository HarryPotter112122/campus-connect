import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDB } from '../lib/db.js';

const router = Router();

// Username policy: 3-24 chars, lowercase letters, digits, underscores
const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

function normalizeUsername(raw) {
  return raw?.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') || '';
}

// ── POST /api/auth/register ───────────────────────────────────
router.post('/register', async (req, res) => {
  const { name, email, password, username } = req.body;

  if (!name?.trim() || !email?.trim() || !password || !username?.trim()) {
    return res.status(400).json({ error: 'Name, username, email, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const uname = normalizeUsername(username);
  if (!USERNAME_RE.test(uname)) {
    return res.status(400).json({ error: 'Username must be 3–24 characters: letters, digits, underscores' });
  }

  const db = getDB();

  if (db.prepare('SELECT id FROM users WHERE email=?').get(email.trim().toLowerCase())) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  if (db.prepare('SELECT id FROM users WHERE username=?').get(uname)) {
    return res.status(409).json({ error: `@${uname} is already taken` });
  }

  // Random avatar color from a curated palette
  const colors = ['#3B82F6','#8B5CF6','#EC4899','#10B981','#F59E0B','#EF4444','#06B6D4','#84CC16'];
  const avatar_color = colors[Math.floor(Math.random() * colors.length)];

  const password_hash = await bcrypt.hash(password, 12);
  db.prepare(`
    INSERT INTO users (name, username, email, password_hash, avatar_color)
    VALUES (?, ?, ?, ?, ?)
  `).run(name.trim(), uname, email.trim().toLowerCase(), password_hash, avatar_color);

  const user = db.prepare('SELECT id, name, username, email, bio, avatar_color, created_at FROM users WHERE email=?')
    .get(email.trim().toLowerCase());

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userUsername = user.username;
    res.status(201).json({ user });
  });
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const db = getDB();
  // Allow login by email OR username
  const user = db.prepare(
    'SELECT * FROM users WHERE email=? OR username=?'
  ).get(email.trim().toLowerCase(), email.trim().toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userUsername = user.username;
    res.json({ user: { id: user.id, name: user.name, username: user.username, email: user.email, bio: user.bio, avatar_color: user.avatar_color, avatar_url: user.avatar_url, created_at: user.created_at } });
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────
router.post('/logout', (req, res) => {
  // Update last_seen_at on logout
  try {
    const db = getDB();
    if (req.session?.userId) {
      db.prepare(`UPDATE users SET last_seen_at=datetime('now') WHERE id=?`).run(req.session.userId);
    }
  } catch (_) {}

  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  const db = getDB();
  const user = db.prepare(
    'SELECT id, name, username, email, bio, avatar_color, avatar_url, created_at FROM users WHERE id=?'
  ).get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ user });
});

export default router;
