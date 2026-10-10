import { getDB } from './db.js';

// ── Presence registry ─────────────────────────────────────────
// Maps userId → Set<socketId>
const onlineUsers = new Map();

/** Returns true if the user has at least one active socket connection */
export function isOnline(userId) {
  const sockets = onlineUsers.get(userId);
  return !!(sockets && sockets.size > 0);
}

// Track typing state: Map<conversationId, Map<userId, {timer, name}>>
const typingUsers = new Map();

// Module-level io reference so routes can import it
let _io = null;
export function getIO() {
  return _io;
}

export function initSocketHandlers(io) {
  _io = io;

  // Auth middleware
  io.use((socket, next) => {
    const session = socket.request.session;
    if (!session?.userId) return next(new Error('Unauthorized'));
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.request.session.userId;
    const userName = socket.request.session.userName;
    console.log(`🔌  Socket connected: user=${userId} (${userName})`);

    // ── Presence: register socket ─────────────────────────────
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    const wasOffline = onlineUsers.get(userId).size === 0;
    onlineUsers.get(userId).add(socket.id);

    // ── Personal room (for notifications to offline/non-joined users) ─
    socket.join(`user:${userId}`);

    // ── Auto-join all accepted conversation rooms ─────────────────────
    const db = getDB();
    const acceptedConvs = db.prepare(`
      SELECT conversation_id FROM conversation_members
      WHERE user_id=? AND status='accepted'
    `).all(userId);
    for (const { conversation_id } of acceptedConvs) {
      socket.join(conversation_id);
    }

    // Broadcast presence:update (online) to all conversation rooms if just came online
    if (wasOffline) {
      for (const { conversation_id } of acceptedConvs) {
        // Broadcast to OTHERS in the room (socket hasn't fully joined yet, so use io.to)
        socket.to(conversation_id).emit('presence:update', { userId, online: true });
      }
    }

    // ── Presence snapshot: tell THIS socket who is already online ─
    // Collect all unique members across this user's conversations
    const convIds = acceptedConvs.map(c => c.conversation_id);
    if (convIds.length > 0) {
      const placeholders = convIds.map(() => '?').join(',');
      const members = db.prepare(`
        SELECT DISTINCT user_id FROM conversation_members
        WHERE conversation_id IN (${placeholders}) AND user_id != ? AND status='accepted'
      `).all(...convIds, userId);

      for (const { user_id } of members) {
        if (isOnline(user_id)) {
          socket.emit('presence:update', { userId: user_id, online: true });
        }
      }
    }

    // Also tell this socket that IT is online (so self-avatar shows green)
    socket.emit('presence:update', { userId, online: true });

    // ── conversation:join (manual join for pending/requests) ──────────
    socket.on('conversation:join', (conversationId, ack) => {
      const db = getDB();
      const member = db.prepare(
        'SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?'
      ).get(conversationId, userId);
      if (!member) return ack?.({ error: 'Not a member of this conversation' });
      socket.join(conversationId);
      ack?.({ ok: true });
    });

    // ── message:send ──────────────────────────────────────────────────
    socket.on('message:send', ({ conversationId, clientMessageId, content, attachmentIds, mentions }, ack) => {
      if (!conversationId || !clientMessageId) {
        return ack?.({ error: 'Invalid message payload' });
      }
      const hasContent = content?.trim();
      const hasAttachments = Array.isArray(attachmentIds) && attachmentIds.length > 0;
      if (!hasContent && !hasAttachments) {
        return ack?.({ error: 'Message must have content or an attachment' });
      }
      if (hasContent && content.length > 4000) {
        return ack?.({ error: 'Message too long (max 4000 chars)' });
      }

      const db = getDB();

      // Authorization: sender must be accepted member
      const member = db.prepare(
        `SELECT status FROM conversation_members WHERE conversation_id=? AND user_id=?`
      ).get(conversationId, userId);
      if (!member || member.status === 'blocked') {
        return ack?.({ error: 'Unauthorized' });
      }

      // Persist (INSERT OR IGNORE for retry dedup)
      let message;
      try {
        db.prepare(`
          INSERT OR IGNORE INTO messages (conversation_id, sender_id, client_message_id, content)
          VALUES (?, ?, ?, ?)
        `).run(conversationId, userId, clientMessageId, (content?.trim()) || '');

        message = db.prepare(`
          SELECT id, conversation_id, sender_id, client_message_id, content, created_at
          FROM messages WHERE sender_id=? AND client_message_id=?
        `).get(userId, clientMessageId);
      } catch (err) {
        console.error('DB insert error:', err);
        return ack?.({ error: 'Failed to save message' });
      }

      // ── Link uploaded attachments to this message ─────────────
      if (hasAttachments) {
        for (const attId of attachmentIds.slice(0, 5)) {
          // Only link attachments that belong to this conv and were uploaded by this sender
          db.prepare(`
            UPDATE attachments SET message_id=?
            WHERE id=? AND conversation_id=? AND uploader_id=? AND message_id IS NULL
          `).run(message.id, attId, conversationId, userId);
        }
      }

      // ── Process group mentions ────────────────────────────────
      const conv = db.prepare(`SELECT type FROM conversations WHERE id=?`).get(conversationId);
      const validMentions = [];
      if (Array.isArray(mentions) && mentions.length > 0 && conv?.type === 'GROUP') {
        const dedupedUserIds = [...new Set(mentions.map(m => m.userId))].filter(uid => uid !== userId);
        for (const mentionedUserId of dedupedUserIds.slice(0, 20)) {
          // Validate: mentioned user must be accepted member
          const isMember = db.prepare(
            `SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=? AND status='accepted'`
          ).get(conversationId, mentionedUserId);
          if (!isMember) continue;

          try {
            db.prepare(`
              INSERT OR IGNORE INTO message_mentions (message_id, conversation_id, mentioned_user_id)
              VALUES (?, ?, ?)
            `).run(message.id, conversationId, mentionedUserId);
            validMentions.push(mentionedUserId);
          } catch (_) {}
        }
      }

      const sender = db.prepare('SELECT id, name, username, avatar_color, avatar_url FROM users WHERE id=?').get(userId);

      // Fetch linked attachments
      const attachments = db.prepare(
        `SELECT id, original_name, mime_type, size, storage_key FROM attachments WHERE message_id=?`
      ).all(message.id);

      // Fetch mention display data
      const mentionData = validMentions.map(uid => {
        const u = db.prepare('SELECT id, name, username FROM users WHERE id=?').get(uid);
        return { userId: u.id, name: u.name, username: u.username };
      });

      const payload = {
        ...message,
        senderName: sender.name,
        sender_name: sender.name,
        sender_username: sender.username,
        sender_color: sender.avatar_color,
        sender_avatar_url: sender.avatar_url,
        attachments,
        mentions: mentionData,
      };

      // Broadcast to room
      io.to(conversationId).emit('message:new', payload);

      // Notify pending members
      const pendingMembers = db.prepare(`
        SELECT user_id FROM conversation_members
        WHERE conversation_id=? AND user_id!=? AND status='pending'
      `).all(conversationId, userId);
      for (const { user_id } of pendingMembers) {
        io.to(`user:${user_id}`).emit('notification:new', {
          conversationId,
          senderName: sender.name,
          content: (content?.trim() || '📎 Attachment').substring(0, 80),
          messageId: message.id,
        });
      }

      // Deliver mention notifications to mentioned users
      for (const mentionedUserId of validMentions) {
        io.to(`user:${mentionedUserId}`).emit('mention:new', {
          messageId: message.id,
          conversationId,
          mentionedBy: sender.name,
          mentionedByUsername: sender.username,
          preview: (content?.trim() || '').substring(0, 100),
        });
      }

      // Stop typing
      clearTyping(io, conversationId, userId);
      ack?.({ ok: true, message: payload });
    });

    // ── typing:start ──────────────────────────────────────────────────
    socket.on('typing:start', ({ conversationId }) => {
      if (!conversationId) return;
      if (!typingUsers.has(conversationId)) typingUsers.set(conversationId, new Map());
      const conv = typingUsers.get(conversationId);
      if (conv.has(userId)) clearTimeout(conv.get(userId).timer);
      const timer = setTimeout(() => clearTyping(io, conversationId, userId), 5000);
      conv.set(userId, { timer, name: userName });
      emitTypingUpdate(io, conversationId);
    });

    // ── typing:stop ───────────────────────────────────────────────────
    socket.on('typing:stop', ({ conversationId }) => {
      clearTyping(io, conversationId, userId);
    });

    // ── disconnect ────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`🔌  Socket disconnected: user=${userId}`);

      // Clear typing state
      for (const [convId] of typingUsers) {
        clearTyping(io, convId, userId);
      }

      // Presence: remove socket
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          // User is now fully offline
          onlineUsers.delete(userId);

          // Update last_seen_at in DB
          const db = getDB();
          db.prepare(`UPDATE users SET last_seen_at=datetime('now') WHERE id=?`).run(userId);

          // Read updated last_seen_at value
          const user = db.prepare(`SELECT last_seen_at FROM users WHERE id=?`).get(userId);
          const lastSeenAt = user?.last_seen_at || null;

          // Broadcast presence:update (offline) to all their accepted conversation rooms
          const convs = db.prepare(`
            SELECT conversation_id FROM conversation_members
            WHERE user_id=? AND status='accepted'
          `).all(userId);

          for (const { conversation_id } of convs) {
            io.to(conversation_id).emit('presence:update', {
              userId,
              online: false,
              lastSeenAt,
            });
          }
        }
      }
    });
  });
}

function clearTyping(io, conversationId, userId) {
  const conv = typingUsers.get(conversationId);
  if (!conv) return;
  const entry = conv.get(userId);
  if (entry) clearTimeout(entry.timer);
  conv.delete(userId);
  emitTypingUpdate(io, conversationId);
}

function emitTypingUpdate(io, conversationId) {
  const conv = typingUsers.get(conversationId);
  const names = conv ? [...conv.values()].map((e) => e.name) : [];
  io.to(conversationId).emit('typing:update', { conversationId, typingUsers: names });
}
