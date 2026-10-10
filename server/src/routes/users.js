import { Router } from 'express';
import { getDB } from '../lib/db.js';

const router = Router();

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

const SAFE_FIELDS = 'id, name, username, bio, avatar_color, avatar_url, last_seen_at, created_at';

// ── GET /api/users?search=... ─────────────────────────────────
// Search by username (@username) or display name
router.get('/', requireAuth, (req, res) => {
  const raw = (req.query.search || '').trim();
  const search = raw.startsWith('@') ? raw.slice(1) : raw;
  const db = getDB();

  let users;
  if (search.length < 1) {
    users = db.prepare(`
      SELECT ${SAFE_FIELDS} FROM users
      WHERE id != ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(req.session.userId);
  } else {
    // Exact username match first, then partial matches
    users = db.prepare(`
      SELECT ${SAFE_FIELDS} FROM users
      WHERE id != ?
        AND (
          username = ? OR
          username LIKE ? OR
          name LIKE ? COLLATE NOCASE
        )
      ORDER BY
        CASE WHEN username = ? THEN 0 ELSE 1 END,
        name
      LIMIT 20
    `).all(
      req.session.userId,
      search.toLowerCase(),
      `${search.toLowerCase()}%`,
      `%${search}%`,
      search.toLowerCase()
    );
  }

  res.json({ users });
});

// ── GET /api/users/:id — public profile ─────────────────────
router.get('/:id', requireAuth, (req, res) => {
  const db = getDB();
  const userId = req.params.id;
  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id=?`).get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Connections: DIRECT chats where this user is accepted/pending
  const connectionsCount = db.prepare(`
    SELECT COUNT(*) as count 
    FROM conversation_members cm
    JOIN conversations c ON cm.conversation_id = c.id
    WHERE cm.user_id = ? AND c.type = 'DIRECT' AND cm.status != 'blocked'
  `).get(userId).count;

  // Groups: GROUP chats where this user is a member
  const groupsCount = db.prepare(`
    SELECT COUNT(*) as count 
    FROM conversation_members cm
    JOIN conversations c ON cm.conversation_id = c.id
    WHERE cm.user_id = ? AND c.type = 'GROUP' AND cm.status = 'accepted'
  `).get(userId).count;

  res.json({ user: { ...user, stats: { connections: connectionsCount, groups: groupsCount } } });
});

// ── PUT /api/users/profile — edit own profile ───────────────
router.put('/profile', requireAuth, (req, res) => {
  const { name, bio, username, avatar_url } = req.body;
  const db = getDB();

  if (name !== undefined && !name?.trim()) {
    return res.status(400).json({ error: 'Name cannot be empty' });
  }
  if (bio !== undefined && bio.length > 300) {
    return res.status(400).json({ error: 'Bio max 300 characters' });
  }

  let newUsername;
  if (username !== undefined) {
    newUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(newUsername)) {
      return res.status(400).json({ error: 'Username: 3–24 chars, letters/digits/underscores only' });
    }
    const taken = db.prepare('SELECT id FROM users WHERE username=? AND id!=?').get(newUsername, req.session.userId);
    if (taken) return res.status(409).json({ error: `@${newUsername} is already taken` });
  }

  // Validate avatar_url: base64 data URL OR preset /avatars/avXX.jpg path, max ~300KB
  if (avatar_url !== undefined && avatar_url !== null && avatar_url !== '') {
    const isPreset = /^\/avatars\/av\d{2}\.jpg$/.test(avatar_url);
    const isBase64 = avatar_url.startsWith('data:image/');
    if (!isPreset && !isBase64) {
      return res.status(400).json({ error: 'Invalid image format' });
    }
    if (isBase64 && avatar_url.length > 300 * 1024) {
      return res.status(400).json({ error: 'Image too large. Max 225KB.' });
    }
  }

  const updates = [];
  const params = [];
  if (name !== undefined)       { updates.push('name=?');       params.push(name.trim()); }
  if (bio !== undefined)        { updates.push('bio=?');        params.push(bio.trim()); }
  if (newUsername)              { updates.push('username=?');   params.push(newUsername); }
  if (avatar_url !== undefined) { updates.push('avatar_url=?'); params.push(avatar_url || null); }

  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.session.userId);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id=?`).run(...params);

  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id=?`).get(req.session.userId);
  if (newUsername) req.session.userUsername = newUsername;
  res.json({ user });
});

export default router;
