import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../../campusconnect.db');

let db;

export function getDB() {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db;
}

export async function initDB() {
  db = new DatabaseSync(DB_PATH);

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name        TEXT NOT NULL,
      email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      type       TEXT NOT NULL DEFAULT 'DIRECT' CHECK(type IN ('DIRECT','GROUP')),
      title      TEXT,
      direct_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_message_id TEXT NOT NULL,
      content           TEXT NOT NULL,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (sender_id, client_message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv
      ON messages (conversation_id, created_at, id);
  `);

  // Safe migration: add status column for message requests feature
  // 'accepted' = normal chat, 'pending' = message request, 'blocked' = blocked
  try {
    db.exec(`ALTER TABLE conversation_members ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted'`);
    console.log('✅  Migrated: added status column');
  } catch (_) { /* Already exists */ }

  // Safe migration: add last_read_at for persistent unread counts
  try {
    db.exec(`ALTER TABLE conversation_members ADD COLUMN last_read_at TEXT`);
    console.log('✅  Migrated: added last_read_at column');
  } catch (_) { /* Already exists */ }

  // Safe migration: add is_muted and is_pinned
  try {
    db.exec(`ALTER TABLE conversation_members ADD COLUMN is_muted INTEGER NOT NULL DEFAULT 0`);
    db.exec(`ALTER TABLE conversation_members ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0`);
    console.log('✅  Migrated: added is_muted and is_pinned columns');
  } catch (_) { /* Already exists */ }

  // Safe migration: add last_read_message_id for exact unread count (no timestamp precision issues)
  try {
    db.exec(`ALTER TABLE conversation_members ADD COLUMN last_read_message_id INTEGER`);
    console.log('✅  Migrated: added last_read_message_id column');
  } catch (_) { /* Already exists */ }

  // Seed last_read_message_id for any rows that don't have it yet
  db.exec(`
    UPDATE conversation_members
    SET last_read_message_id = (
      SELECT MAX(m.id) FROM messages m
      WHERE m.conversation_id = conversation_members.conversation_id
    )
    WHERE last_read_message_id IS NULL
  `);

  // Safe migration: add username (unique @handle)
  try {
    db.exec(`ALTER TABLE users ADD COLUMN username TEXT`);
    // Seed existing users with a username derived from their name
    db.exec(`
      UPDATE users SET username = lower(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(replace(
          replace(replace(replace(replace(replace(replace(replace(
            replace(replace(replace(replace(replace(replace(replace(
              replace(replace(replace(replace(trim(name),' ','_'),
              'ā','a'),'ē','e'),'ī','i'),'ō','o'),'ū','u'),
              'ä','a'),'ë','e'),'ï','i'),'ö','o'),'ü','u'),
              'á','a'),'é','e'),'í','i'),'ó','o'),'ú','u'),
              'à','à'),'â','a'),'ê','e'),'î','i'),'ô','o'),
              'û','u'),'ñ','n'),'ç','c'),'ß','ss')
        )
      WHERE username IS NULL
    `);
    console.log('✅  Migrated: added username column');
  } catch (_) { /* Already exists */ }

  // Ensure username unique index
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
  } catch (_) {}

  // Safe migration: add bio
  try {
    db.exec(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`);
    console.log('✅  Migrated: added bio column');
  } catch (_) {}

  // Safe migration: add last_seen_at
  try {
    db.exec(`ALTER TABLE users ADD COLUMN last_seen_at TEXT`);
    console.log('✅  Migrated: added last_seen_at column');
  } catch (_) {}

  // Safe migration: add avatar_color (random color for initials avatar)
  try {
    db.exec(`ALTER TABLE users ADD COLUMN avatar_color TEXT DEFAULT '#3B82F6'`);
    console.log('✅  Migrated: added avatar_color column');
  } catch (_) {}

  // Safe migration: add avatar_url (base64 compressed profile picture)
  try {
    db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT`);
    console.log('✅  Migrated: added avatar_url column');
  } catch (_) {}

  try {
    db.exec(`ALTER TABLE conversations ADD COLUMN owner_id TEXT REFERENCES users(id)`);
    console.log('✅  Migrated: added owner_id to conversations');
  } catch (_) {}

  // ── Attachments table ────────────────────────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    uploader_id TEXT NOT NULL REFERENCES users(id),
    storage_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_att_msg  ON attachments(message_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_att_conv ON attachments(conversation_id)`);

  // ── Message mentions table ───────────────────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS message_mentions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    mentioned_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(message_id, mentioned_user_id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ment_user ON message_mentions(mentioned_user_id, is_read)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ment_conv ON message_mentions(conversation_id)`);

  console.log('✅  SQLite database initialized at', DB_PATH);
  return db;
}
