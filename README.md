# CampusConnect

> A campus messaging platform that turns conversations into actionable plans.

[![Node.js](https://img.shields.io/badge/Node.js-v18+-green)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-blue)](https://reactjs.org)

## Features

- 🔐 **Secure Authentication** – Register, login, and persistent sessions with HttpOnly cookies
- 💬 **Real-time Messaging** – Socket.IO powered chat with instant delivery
- 🔍 **User Discovery** – Search any registered student by name or email
- 💾 **Persistent History** – Messages survive refresh and reconnect
- ⌨️ **Typing Indicators** – See when the other person is typing
- 🔔 **Unread Badges** – Never miss a message
- ⚡ **Action Summary** – AI-powered analysis extracting decisions, tasks, and open questions from any conversation
- 📱 **Responsive UI** – Works on mobile and desktop

## AI Differentiator: Action Summary

Click **"Action Summary"** in any conversation to get:

| Field | Example |
|---|---|
| **Decision** | Meet at the library tomorrow at 4 |
| **Task** | Rahul → prepare slides (deadline: Sunday) |
| **Task** | Maya → finish the API (deadline: Not specified) |
| **Open Question** | Who will book the conference room? |

The AI only reports what the conversation explicitly states. No invented tasks or deadlines.

## Architecture

```
React (Vite + Tailwind)
    │
    ├── HTTP  →  Express REST API
    └── WS    →  Socket.IO (authenticated via session)
                      │
                 SQLite (better-sqlite3)
```

## Quick Start

### Prerequisites
- Node.js 18+
- A Google AI API key (for AI summaries) → [Get one free](https://makersuite.google.com/app/apikey)

### 1. Clone and install

```bash
git clone <your-repo>
cd campusconnect

# Install server deps
cd server && npm install && cd ..

# Install client deps
cd client && npm install && cd ..
```

### 2. Configure environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:
```env
PORT=3001
SESSION_SECRET=a-long-random-string-here
AI_API_KEY=your_google_ai_api_key
NODE_ENV=development
CLIENT_URL=http://localhost:5173
```

### 3. Run

**Terminal 1 – Backend:**
```bash
cd server
npm run dev
```

**Terminal 2 – Frontend:**
```bash
cd client
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Testing the App

Use **two different browser profiles** (not just tabs — they share sessions).

1. Register **Account A** in Chrome
2. Register **Account B** in a Chrome Incognito window (or Firefox)
3. From Account A, search for Account B by name
4. Click to start a conversation
5. Send messages in both directions
6. Refresh both windows — history persists
7. Click **"Action Summary"** after a multi-message conversation

## Project Structure

```
campusconnect/
├── server/
│   ├── src/
│   │   ├── index.js          # Express + Socket.IO server
│   │   ├── lib/
│   │   │   ├── db.js         # SQLite initialization
│   │   │   └── socket.js     # Socket.IO event handlers
│   │   └── routes/
│   │       ├── auth.js       # Register, login, logout, /me
│   │       ├── users.js      # User search
│   │       ├── conversations.js  # Conversations + messages
│   │       └── summary.js    # AI summary endpoint
│   ├── .env.example
│   └── package.json
└── client/
    ├── src/
    │   ├── App.jsx
    │   ├── hooks/useAuth.jsx  # Auth context
    │   ├── lib/
    │   │   ├── api.js         # HTTP client
    │   │   └── socket.js      # Socket.IO singleton
    │   ├── pages/
    │   │   ├── AuthPage.jsx   # Login / Register
    │   │   └── ChatPage.jsx   # Main chat UI
    │   └── components/
    │       └── ChatWindow.jsx # Chat + Summary panel
    ├── vite.config.js
    └── package.json
```

## Security Notes

- Passwords hashed with bcrypt (12 rounds)
- Session regenerated on login
- HttpOnly, SameSite cookies
- Auth guard on every conversation operation
- Socket rooms require membership verification
- AI summary is user-triggered only; never automatic
- No message HTML injection — all content rendered as text

## API Reference

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Current user |
| GET | `/api/users?search=` | Search students |
| GET | `/api/conversations` | My conversations |
| POST | `/api/conversations/direct` | Start/get direct chat |
| GET | `/api/conversations/:id/messages` | Message history |
| POST | `/api/conversations/:id/summary` | AI action summary |

## Built With

- [React](https://reactjs.org) + [Vite](https://vitejs.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [Socket.IO](https://socket.io)
- [Express](https://expressjs.com)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [Google Gemini API](https://ai.google.dev)
