import { Router } from 'express';
import { getDB } from '../lib/db.js';
import { isOnline, getIO } from '../lib/socket.js';

const router = Router();

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function getConvWithMembers(db, convId) {
  const conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(convId);
  if (!conv) return null;
  const members = db.prepare(`
    SELECT u.id, u.name, u.email, cm.status as member_status
    FROM users u
    JOIN conversation_members cm ON cm.user_id = u.id
    WHERE cm.conversation_id = ?
  `).all(convId);
  return { ...conv, members };
}

// ── GET /api/conversations ─────────────────────────────────────
// Returns conversations the user has ACCEPTED, with server-side unread counts
router.get('/', requireAuth, (req, res) => {
  const db = getDB();
  const userId = req.session.userId;

  const conversations = db.prepare(`
    SELECT c.id, c.type, c.title, c.direct_key, c.created_at, c.owner_id, cm.status as user_status, cm.is_muted, cm.is_pinned,
           (SELECT content FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC, id DESC LIMIT 1) as last_message,
           (SELECT created_at FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC, id DESC LIMIT 1) as last_message_at,
           (SELECT COUNT(*) FROM messages m
            WHERE m.conversation_id = c.id
            AND m.sender_id != ?
            AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
           ) as unread_count
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    WHERE cm.status = 'accepted'
    ORDER BY cm.is_pinned DESC, coalesce(last_message_at, c.created_at) DESC
  `).all(userId, userId);

  const withMembers = conversations.map((conv) => {
    const members = db.prepare(`
      SELECT u.id, u.name, u.username, u.bio, u.avatar_color, u.last_seen_at,
             cm.status as member_status
      FROM users u JOIN conversation_members cm ON cm.user_id = u.id
      WHERE cm.conversation_id = ?
    `).all(conv.id);

    const membersWithPresence = members.map((m) => ({
      ...m,
      is_online: isOnline(m.id),
    }));

    return { ...conv, members: membersWithPresence };
  });

  res.json({ conversations: withMembers });
});

// ── GET /api/conversations/requests ───────────────────────────
// Returns conversations pending the user's acceptance
router.get('/requests', requireAuth, (req, res) => {
  const db = getDB();
  const conversations = db.prepare(`
    SELECT c.id, c.type, c.title, c.direct_key, c.created_at, cm.status as user_status,
           (SELECT content FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC, id DESC LIMIT 1) as last_message,
           (SELECT created_at FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC, id DESC LIMIT 1) as last_message_at,
           (SELECT COUNT(*) FROM messages WHERE conversation_id=c.id) as message_count
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    WHERE cm.status = 'pending'
    ORDER BY coalesce(last_message_at, c.created_at) DESC
  `).all(req.session.userId);

  const withMembers = conversations.map((conv) => {
    const members = db.prepare(`
      SELECT u.id, u.name, u.email, cm.status as member_status
      FROM users u JOIN conversation_members cm ON cm.user_id = u.id
      WHERE cm.conversation_id = ?
    `).all(conv.id);
    return { ...conv, members, isRequest: true };
  });

  res.json({ conversations: withMembers });
});

// ── POST /api/conversations/direct ────────────────────────────
router.post('/direct', requireAuth, (req, res) => {
  const { targetUserId } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });

  const myId = req.session.userId;
  if (targetUserId === myId) return res.status(400).json({ error: 'Cannot chat with yourself' });

  const db = getDB();
  const targetUser = db.prepare('SELECT id, name FROM users WHERE id=?').get(targetUserId);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  // Check if target has blocked this user
  const [a, b] = [myId, targetUserId].sort();
  const directKey = `${a}:${b}`;

  let conversation = db.prepare('SELECT * FROM conversations WHERE direct_key=?').get(directKey);

  if (!conversation) {
    // New conversation: initiator = accepted, receiver = pending (message request)
    db.prepare(`INSERT OR IGNORE INTO conversations (type, direct_key) VALUES ('DIRECT', ?)`).run(directKey);
    conversation = db.prepare('SELECT * FROM conversations WHERE direct_key=?').get(directKey);

    db.prepare(`
      INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, status)
      VALUES (?, ?, 'accepted')
    `).run(conversation.id, myId);

    db.prepare(`
      INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, status)
      VALUES (?, ?, 'pending')
    `).run(conversation.id, targetUserId);
  } else {
    // Conversation exists — check if receiver blocked this user
    const myMembership = db.prepare(
      `SELECT status FROM conversation_members WHERE conversation_id=? AND user_id=?`
    ).get(conversation.id, myId);

    if (!myMembership) {
      // I was removed/blocked — re-add as accepted (they initiated, I'm re-joining)
      db.prepare(`
        INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, status)
        VALUES (?, ?, 'accepted')
      `).run(conversation.id, myId);
    }

    const targetMembership = db.prepare(
      `SELECT status FROM conversation_members WHERE conversation_id=? AND user_id=?`
    ).get(conversation.id, targetUserId);

    if (targetMembership?.status === 'blocked') {
      return res.status(403).json({ error: 'Unable to start a conversation with this user' });
    }
  }

  const conv = getConvWithMembers(db, conversation.id);
  res.json({ conversation: conv });
});

// ── POST /api/conversations/group ─────────────────────────────
router.post('/group', requireAuth, (req, res) => {
  const { name, memberIds } = req.body;
  const myId = req.session.userId;

  // Validate name
  if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 50) {
    return res.status(400).json({ error: 'Group name must be 1–50 characters' });
  }

  // Validate memberIds
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ error: 'memberIds must be a non-empty array' });
  }

  // Deduplicate and exclude self (creator added separately)
  const uniqueIds = [...new Set(memberIds.filter((id) => id !== myId))];

  // Max 20 members total (including creator)
  if (uniqueIds.length + 1 > 20) {
    return res.status(400).json({ error: 'Group cannot have more than 20 members' });
  }

  const db = getDB();

  // Verify all memberIds exist
  for (const memberId of uniqueIds) {
    const user = db.prepare('SELECT id FROM users WHERE id=?').get(memberId);
    if (!user) return res.status(404).json({ error: `User ${memberId} not found` });
  }

  // Create the group conversation
  const conversation = db.prepare(`
    INSERT INTO conversations (type, title, owner_id) VALUES ('GROUP', ?, ?)
    RETURNING *
  `).get(name.trim(), myId);

  // Add creator as accepted member
  db.prepare(`
    INSERT INTO conversation_members (conversation_id, user_id, status) VALUES (?, ?, 'accepted')
  `).run(conversation.id, myId);

  // Add all other members as accepted
  for (const memberId of uniqueIds) {
    db.prepare(`
      INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, status)
      VALUES (?, ?, 'accepted')
    `).run(conversation.id, memberId);
  }

  const conv = getConvWithMembers(db, conversation.id);

  // Notify each member via their personal room
  const io = getIO();
  if (io) {
    const allMemberIds = [myId, ...uniqueIds];
    for (const memberId of allMemberIds) {
      io.to(`user:${memberId}`).emit('conversation:new', conv);
    }
  }

  res.status(201).json({ conversation: conv });
});

// ── POST /api/conversations/:id/accept ────────────────────────
router.post('/:id/accept', requireAuth, (req, res) => {
  const db = getDB();
  const { id } = req.params;

  const member = db.prepare(
    `SELECT status FROM conversation_members WHERE conversation_id=? AND user_id=?`
  ).get(id, req.session.userId);

  if (!member) return res.status(403).json({ error: 'Not a member of this conversation' });

  db.prepare(
    `UPDATE conversation_members SET status='accepted' WHERE conversation_id=? AND user_id=?`
  ).run(id, req.session.userId);

  const conv = getConvWithMembers(db, id);
  res.json({ conversation: conv });
});

// ── POST /api/conversations/:id/block ─────────────────────────
router.post('/:id/block', requireAuth, (req, res) => {
  const db = getDB();
  const { id } = req.params;

  const member = db.prepare(
    `SELECT status FROM conversation_members WHERE conversation_id=? AND user_id=?`
  ).get(id, req.session.userId);

  if (!member) return res.status(403).json({ error: 'Not a member of this conversation' });

  db.prepare(
    `UPDATE conversation_members SET status='blocked' WHERE conversation_id=? AND user_id=?`
  ).run(id, req.session.userId);

  res.json({ ok: true });
});

// ── PUT /api/conversations/:id/mute ───────────────────────────
router.put('/:id/mute', requireAuth, (req, res) => {
  const db = getDB();
  const { id } = req.params;
  const { value } = req.body;

  const member = db.prepare(
    `SELECT status FROM conversation_members WHERE conversation_id=? AND user_id=?`
  ).get(id, req.session.userId);

  if (!member) return res.status(403).json({ error: 'Not a member of this conversation' });

  db.prepare(
    `UPDATE conversation_members SET is_muted=? WHERE conversation_id=? AND user_id=?`
  ).run(value ? 1 : 0, id, req.session.userId);

  res.json({ ok: true });
});

// ── PUT /api/conversations/:id/pin ────────────────────────────
router.put('/:id/pin', requireAuth, (req, res) => {
  const db = getDB();
  const { id } = req.params;
  const { value } = req.body;

  const member = db.prepare(
    `SELECT status FROM conversation_members WHERE conversation_id=? AND user_id=?`
  ).get(id, req.session.userId);

  if (!member) return res.status(403).json({ error: 'Not a member of this conversation' });

  db.prepare(
    `UPDATE conversation_members SET is_pinned=? WHERE conversation_id=? AND user_id=?`
  ).run(value ? 1 : 0, id, req.session.userId);

  res.json({ ok: true });
});

// ── POST /api/conversations/:id/read ──────────────────────────
// Marks a conversation as read up to a specific message ID
router.post('/:id/read', requireAuth, (req, res) => {
  const db = getDB();
  const { id } = req.params;
  const { lastMessageId } = req.body;

  const member = db.prepare(
    `SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?`
  ).get(id, req.session.userId);
  if (!member) return res.status(403).json({ error: 'Not a member' });

  // If client sends a lastMessageId, use it; otherwise find the current last message
  let msgId = lastMessageId;
  if (!msgId) {
    const lastMsg = db.prepare(
      `SELECT id FROM messages WHERE conversation_id=? ORDER BY created_at DESC, id DESC LIMIT 1`
    ).get(id);
    msgId = lastMsg?.id || null;
  }

  db.prepare(
    `UPDATE conversation_members
     SET last_read_at=datetime('now'), last_read_message_id=?
     WHERE conversation_id=? AND user_id=?`
  ).run(msgId, id, req.session.userId);

  res.json({ ok: true, lastReadMessageId: msgId });
});

// ── GET /api/conversations/:id/messages ───────────────────────
router.get('/:id/messages', requireAuth, (req, res) => {
  const db = getDB();
  const conversationId = req.params.id;
  const cursor = req.query.cursor;
  const LIMIT = 50;

  const member = db.prepare(
    `SELECT status FROM conversation_members WHERE conversation_id=? AND user_id=?`
  ).get(conversationId, req.session.userId);
  if (!member || member.status === 'blocked') return res.status(403).json({ error: 'Access denied' });

  let messages;
  if (cursor) {
    let cursorTime = cursor;
    let cursorId = null;
    const underscoreIndex = cursor.indexOf('_');
    if (underscoreIndex !== -1) {
      cursorTime = cursor.slice(0, underscoreIndex);
      cursorId = cursor.slice(underscoreIndex + 1);
    }
    
    if (cursorId) {
      messages = db.prepare(`
        SELECT m.id, m.conversation_id, m.sender_id, m.client_message_id, m.content, m.created_at,
               u.name as sender_name, u.username as sender_username, u.avatar_color as sender_color, u.avatar_url as sender_avatar_url
        FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ? AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ?
      `).all(conversationId, cursorTime, cursorTime, cursorId, LIMIT);
    } else {
      messages = db.prepare(`
        SELECT m.id, m.conversation_id, m.sender_id, m.client_message_id, m.content, m.created_at,
               u.name as sender_name, u.username as sender_username, u.avatar_color as sender_color, u.avatar_url as sender_avatar_url
        FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ? AND m.created_at < ?
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ?
      `).all(conversationId, cursorTime, LIMIT);
    }
  } else {
    messages = db.prepare(`
      SELECT m.id, m.conversation_id, m.sender_id, m.client_message_id, m.content, m.created_at,
             u.name as sender_name, u.username as sender_username, u.avatar_color as sender_color, u.avatar_url as sender_avatar_url
      FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?
    `).all(conversationId, LIMIT);
  }

  // Enrich with attachments and mentions
  const enriched = messages.reverse().map(msg => {
    const attachments = db.prepare(
      `SELECT id, original_name, mime_type, size, storage_key FROM attachments WHERE message_id=?`
    ).all(msg.id);
    const mentions = db.prepare(
      `SELECT mm.mentioned_user_id as userId, u.name, u.username
       FROM message_mentions mm JOIN users u ON u.id=mm.mentioned_user_id
       WHERE mm.message_id=?`
    ).all(msg.id);
    return { ...msg, attachments, mentions };
  });

  res.json({ messages: enriched, hasMore: messages.length === LIMIT });
});

// ── GET /api/conversations/:id/mentions ───────────────────────
// Unread mentions for the current user in this conversation
router.get('/:id/mentions', requireAuth, (req, res) => {
  const db = getDB();
  const member = db.prepare(
    `SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=? AND status='accepted'`
  ).get(req.params.id, req.session.userId);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const mentions = db.prepare(`
    SELECT mm.id, mm.message_id, mm.created_at,
           m.content as message_content, m.conversation_id,
           u.name as mentioned_by_name, u.username as mentioned_by_username
    FROM message_mentions mm
    JOIN messages m ON m.id = mm.message_id
    JOIN users u ON u.id = m.sender_id
    WHERE mm.conversation_id=? AND mm.mentioned_user_id=? AND mm.is_read=0
    ORDER BY mm.created_at DESC LIMIT 50
  `).all(req.params.id, req.session.userId);

  res.json({ mentions });
});

// ── POST /api/conversations/:id/mentions/read ─────────────────
router.post('/:id/mentions/read', requireAuth, (req, res) => {
  const db = getDB();
  db.prepare(
    `UPDATE message_mentions SET is_read=1 WHERE conversation_id=? AND mentioned_user_id=?`
  ).run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

// ── GET /api/conversations/:id/members ────────────────────────
router.get('/:id/members', requireAuth, (req, res) => {
  const db = getDB();
  const { id } = req.params;

  // Must be a member
  const membership = db.prepare(
    `SELECT status FROM conversation_members WHERE conversation_id=? AND user_id=?`
  ).get(id, req.session.userId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this conversation' });

  const members = db.prepare(`
    SELECT u.id, u.name, u.username, u.bio, u.avatar_color, u.last_seen_at,
           cm.status as member_status, cm.joined_at
    FROM users u
    JOIN conversation_members cm ON cm.user_id = u.id
    WHERE cm.conversation_id = ?
    ORDER BY cm.joined_at ASC
  `).all(id);

  const membersWithPresence = members.map((m) => ({
    ...m,
    is_online: isOnline(m.id),
  }));

  res.json({ members: membersWithPresence });
});

// ── POST /api/conversations/:id/members ───────────────────────
router.post('/:id/members', requireAuth, (req, res) => {
  const db = getDB();
  const { id } = req.params;
  const { userId: newUserId } = req.body;
  const myId = req.session.userId;

  if (!newUserId) return res.status(400).json({ error: 'userId required' });

  // Must be owner
  const conv = db.prepare('SELECT owner_id FROM conversations WHERE id=?').get(id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  if (conv.owner_id !== myId) return res.status(403).json({ error: 'Only the owner can add members' });

  // Target user must exist
  const targetUser = db.prepare('SELECT id FROM users WHERE id=?').get(newUserId);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  // Check group size limit
  const currentMembers = db.prepare('SELECT COUNT(*) as count FROM conversation_members WHERE conversation_id=?').get(id).count;
  if (currentMembers >= 20) {
    return res.status(400).json({ error: 'Group cannot have more than 20 members' });
  }

  // Add as accepted member
  db.prepare(`
    INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, status)
    VALUES (?, ?, 'accepted')
  `).run(id, newUserId);

  const io = getIO();
  if (io) {
    io.to(id).emit('membership:updated', { conversationId: id });
    const fullConv = getConvWithMembers(db, id);
    io.to(`user:${newUserId}`).emit('conversation:new', fullConv);
  }

  res.json({ ok: true });
});

// ── DELETE /api/conversations/:id/members/:userId ─────────────
router.delete('/:id/members/:userId', requireAuth, (req, res) => {
  const db = getDB();
  const { id, userId: targetId } = req.params;
  const myId = req.session.userId;

  // Must be owner
  const conv = db.prepare('SELECT owner_id FROM conversations WHERE id=?').get(id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  if (conv.owner_id !== myId) return res.status(403).json({ error: 'Only the owner can remove members' });

  // Cannot remove yourself (use /leave)
  if (targetId === myId) return res.status(400).json({ error: 'Use /leave to leave the conversation' });

  db.prepare(
    `DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?`
  ).run(id, targetId);

  const io = getIO();
  if (io) {
    io.to(id).emit('membership:updated', { conversationId: id });
    io.to(`user:${targetId}`).emit('membership:removed', { conversationId: id });
  }

  res.json({ ok: true });
});

// ── POST /api/conversations/:id/transfer-owner ────────────────
router.post('/:id/transfer-owner', requireAuth, (req, res) => {
  const db = getDB();
  const { id } = req.params;
  const { userId: newOwnerId } = req.body;
  const myId = req.session.userId;

  if (!newOwnerId) return res.status(400).json({ error: 'userId required' });

  // Must be current owner
  const conv = db.prepare('SELECT owner_id FROM conversations WHERE id=?').get(id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  if (conv.owner_id !== myId) return res.status(403).json({ error: 'Only the current owner can transfer ownership' });

  // New owner must be a member
  const membership = db.prepare(
    `SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=? AND status='accepted'`
  ).get(id, newOwnerId);
  if (!membership) return res.status(400).json({ error: 'New owner must be a member of the conversation' });

  db.prepare(`UPDATE conversations SET owner_id=? WHERE id=?`).run(newOwnerId, id);

  const io = getIO();
  if (io) {
    const updatedConv = db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
    io.to(id).emit('conversation:updated', { conversationId: id, owner_id: newOwnerId, conversation: updatedConv });
  }

  res.json({ ok: true });
});

// ── POST /api/conversations/:id/leave ─────────────────────────
router.post('/:id/leave', requireAuth, (req, res) => {
  const db = getDB();
  const { id } = req.params;
  const myId = req.session.userId;

  // Must be a member
  const membership = db.prepare(
    `SELECT status FROM conversation_members WHERE conversation_id=? AND user_id=?`
  ).get(id, myId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this conversation' });

  // If owner, must transfer first
  const conv = db.prepare('SELECT owner_id FROM conversations WHERE id=?').get(id);
  if (conv?.owner_id === myId) {
    return res.status(400).json({ error: 'Transfer ownership before leaving' });
  }

  db.prepare(`DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?`).run(id, myId);

  const io = getIO();
  if (io) {
    io.to(id).emit('membership:updated', { conversationId: id });
  }

  res.json({ ok: true });
});

// ── DELETE /api/conversations/:id ────────────────────────────
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDB();
  const { id } = req.params;
  const myId = req.session.userId;

  // Must be owner
  const conv = db.prepare('SELECT owner_id FROM conversations WHERE id=?').get(id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  if (conv.owner_id !== myId) return res.status(403).json({ error: 'Only the owner can delete this conversation' });

  // Emit before delete so room is still populated
  const io = getIO();
  if (io) {
    io.to(id).emit('conversation:deleted', { conversationId: id });
  }

  db.prepare(`DELETE FROM conversations WHERE id=?`).run(id);

  res.json({ ok: true });
});

// ── PUT /api/conversations/:id/rename ─────────────────────────
router.put('/:id/rename', requireAuth, (req, res) => {
  const db = getDB();
  const { id } = req.params;
  const { name } = req.body;
  const myId = req.session.userId;

  if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 50) {
    return res.status(400).json({ error: 'Name must be 1–50 characters' });
  }

  // Must be owner
  const conv = db.prepare('SELECT owner_id FROM conversations WHERE id=?').get(id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  if (conv.owner_id !== myId) return res.status(403).json({ error: 'Only the owner can rename this conversation' });

  db.prepare(`UPDATE conversations SET title=? WHERE id=?`).run(name.trim(), id);

  const updatedConv = db.prepare('SELECT * FROM conversations WHERE id=?').get(id);

  const io = getIO();
  if (io) {
    io.to(id).emit('conversation:updated', { conversationId: id, title: name.trim(), conversation: updatedConv });
  }

  res.json({ ok: true, conversation: updatedConv });
});

export default router;
