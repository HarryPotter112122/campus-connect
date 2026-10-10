import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import session from 'express-session';
import FileStore from 'session-file-store';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';

import { initDB } from './lib/db.js';
import { initSocketHandlers } from './lib/socket.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import conversationsRouter from './routes/conversations.js';
import summaryRouter from './routes/summary.js';
import uploadsRouter from './routes/uploads.js';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  },
});

// ─── Middleware ───────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

const sessionMiddleware = session({
  store: new (FileStore(session))({
    path: './sessions',
    ttl: 7 * 24 * 60 * 60, // 7 days in seconds
    reapInterval: 60 * 60,  // Clean expired sessions hourly
    logFn: () => {},         // Suppress noisy logs
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
});

app.use(sessionMiddleware);

// Share session with Socket.IO
io.engine.use(sessionMiddleware);

// ─── Rate limiting ────────────────────────────────────────────
const isDev = process.env.NODE_ENV !== 'production';
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,           // 15 minute window
  max: isDev ? 500 : 20,              // 500 in dev (no blocking while testing), 20 in prod
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
  skip: () => isDev,                  // Completely skip in dev mode
});

// ─── Routes ──────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/users', usersRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/conversations', summaryRouter);
app.use('/api/upload', uploadsRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ─── 404 & Error handler ──────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Socket.IO ───────────────────────────────────────────────
initSocketHandlers(io);

// ─── Start ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

initDB().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`✅  CampusConnect server running on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

export { io };
