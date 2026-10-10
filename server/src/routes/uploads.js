import { Router } from 'express';
import multer from 'multer';
import { createReadStream, existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, '../../uploads');
const router = Router();

// ── Auth middleware ────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// ── Allowed MIME types (allowlist) ────────────────────────────
const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

// Magic byte signatures for types where we can check
const MAGIC = {
  'image/jpeg':       [0xFF, 0xD8, 0xFF],
  'image/png':        [0x89, 0x50, 0x4E, 0x47],
  'image/gif':        [0x47, 0x49, 0x46, 0x38],
  'image/webp':       [0x52, 0x49, 0x46, 0x46], // RIFF
  'application/pdf':  [0x25, 0x50, 0x44, 0x46], // %PDF
  'video/webm':       [0x1A, 0x45, 0xDF, 0xA3],
  'audio/ogg':        [0x4F, 0x67, 0x67, 0x53], // OggS
};

function checkMagic(buffer, mimeType) {
  const sig = MAGIC[mimeType];
  if (!sig) return true; // no signature check for this type — allow
  for (let i = 0; i < sig.length; i++) {
    if (buffer[i] !== sig[i]) return false;
  }
  return true;
}

// ── Multer config ─────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    // UUID-based storage key, no extension (prevents execution via guessing)
    cb(null, `${crypto.randomUUID()}.bin`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      return cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

// ── POST /api/upload/:conversationId ─────────────────────────
router.post('/:conversationId', requireAuth, (req, res, next) => {
  const { conversationId } = req.params;
  const userId = req.session.userId;
  const db = getDB();

  // Verify membership before accepting files
  const member = db.prepare(
    `SELECT status FROM conversation_members WHERE conversation_id=? AND user_id=?`
  ).get(conversationId, userId);

  if (!member || member.status === 'blocked') {
    return res.status(403).json({ error: 'Not authorized for this conversation' });
  }

  upload.array('files', 5)(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 25 MB)' : err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });

    const results = [];
    const toDelete = [];

    for (const file of req.files) {
      // Read magic bytes to validate content
      try {
        const fd = await new Promise((resolve, reject) => {
          import('fs').then(({ openSync, readSync, closeSync }) => {
            const fd = openSync(file.path, 'r');
            const buf = Buffer.alloc(8);
            readSync(fd, buf, 0, 8, 0);
            closeSync(fd);
            resolve(buf);
          }).catch(reject);
        });

        if (!checkMagic(fd, file.mimetype)) {
          toDelete.push(file.path);
          results.push({ error: `${file.originalname}: invalid file content`, originalname: file.originalname });
          continue;
        }
      } catch (_) {
        // Can't read magic — allow (best effort)
      }

      // Save metadata to DB
      const storageKey = basename(file.filename);
      db.prepare(`
        INSERT INTO attachments (conversation_id, uploader_id, storage_key, original_name, mime_type, size)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(conversationId, userId, storageKey, file.originalname, file.mimetype, file.size);

      const att = db.prepare(`SELECT id, original_name, mime_type, size, storage_key FROM attachments WHERE storage_key=?`).get(storageKey);
      results.push(att);
    }

    // Clean up invalid files
    for (const p of toDelete) unlink(p).catch(() => {});

    const valid = results.filter(r => !r.error);
    const errors = results.filter(r => r.error).map(r => r.error);

    if (!valid.length) return res.status(400).json({ error: errors.join('; ') });
    res.json({ attachments: valid, warnings: errors.length ? errors : undefined });
  });
});

// ── GET /api/upload/file/:storageKey ──────────────────────────
router.get('/file/:storageKey', requireAuth, (req, res) => {
  const { storageKey } = req.params;
  const userId = req.session.userId;

  // Validate storage key format (UUID.bin)
  if (!/^[0-9a-f-]{36}\.bin$/.test(storageKey)) {
    return res.status(400).json({ error: 'Invalid file key' });
  }

  const db = getDB();
  const att = db.prepare(`SELECT * FROM attachments WHERE storage_key=?`).get(storageKey);
  if (!att) return res.status(404).json({ error: 'File not found' });

  // Authorization: must be an accepted member of the conversation
  const member = db.prepare(
    `SELECT status FROM conversation_members WHERE conversation_id=? AND user_id=?`
  ).get(att.conversation_id, userId);

  if (!member || member.status === 'blocked') {
    return res.status(403).json({ error: 'Access denied' });
  }

  const filePath = join(UPLOADS_DIR, storageKey);
  if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

  // Safe filename in Content-Disposition
  const safeName = att.original_name.replace(/[^\w.\-]/g, '_');
  res.setHeader('Content-Type', att.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Content-Length', att.size);
  res.setHeader('Cache-Control', 'private, max-age=3600');

  createReadStream(filePath).pipe(res);
});

export default router;
