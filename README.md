# CampusConnect

> A real-time campus messaging platform designed to connect students seamlessly.

[![Node.js](https://img.shields.io/badge/Node.js-v18+-green)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-blue)](https://reactjs.org)

*(Note: This repository will remain private until the end of the hackathon, in accordance with the submission guidelines. It will be made public when submitting the final entry.)*

---

## 1. Application Architecture

CampusConnect follows a modern client-server architecture:

- **Frontend (Client):** Built with React, Vite, and Tailwind CSS. It is a Single Page Application (SPA) that communicates with the backend via REST APIs for standard data (auth, user search, historical messages) and WebSockets for real-time events.
- **Backend (Server):** Built using Node.js and Express. It serves REST API endpoints and manages WebSocket connections using Socket.IO.
- **Database:** Uses `better-sqlite3` for a lightweight, fast, and local persistent SQLite database (`campusconnect.db`).
- **Authentication:** Uses secure HTTP-only cookies and `express-session`. Sessions are seamlessly shared between Express HTTP routes and Socket.IO connections to ensure WebSocket endpoints are strictly authenticated.

## 2. Real-Time Communication Technology

Real-time chat functionality is powered by **Socket.IO** (over WebSockets). 
- When a user successfully authenticates via HTTP, a secure session cookie is set.
- The Socket.IO client connects to the server and automatically passes this cookie.
- The server's Socket.IO instance uses middleware to parse the session cookie, ensuring only authenticated users can establish a persistent WebSocket connection.
- Users are dynamically placed into private Socket.IO "rooms" representing their authorized conversations.
- When a message is sent via Socket.IO, it is broadcasted instantly to all connected clients in that specific conversation room, enabling instantaneous delivery without polling.

## 3. Major Features

- 💬 **Real-time Messaging** – Instant message delivery using WebSockets.
- 📎 **Media & File Sharing** – Upload and share images, videos, audio, and documents within chats.
- 👥 **Direct & Group Chats** – Create 1-on-1 direct conversations or multi-member group chats.
- 🔔 **Unread Badges & Read Receipts** – Tracks exactly which messages are unread using chronological timestamps and displays double checkmarks for read statuses.
- ⏳ **Typing Indicators** – Real-time visual feedback when the other participant is typing.
- 🔍 **User Discovery** – Search for registered students by name or email to easily begin chatting.
- 📌 **Chat Management** – Pin important chats, mute notifications, and view exact timestamps/date dividers for older messages.
- 🤖 **Action Summary (AI Integration)** – Extracts decisions, tasks, and open questions from a conversation using Google's Gemini AI.

## 4. Required Environment Variables & External Services

To run this application, you need to configure the following environment variables in `server/.env`:

- `PORT` - The port the backend server runs on (default: `3001`).
- `SESSION_SECRET` - A cryptographic secret string used to sign session cookies.
- `AI_API_KEY` - A Google AI API key used for the Action Summary feature (get a free key at [Google AI Studio](https://aistudio.google.com/app/apikey)).
- `NODE_ENV` - Set to `development` for local testing.
- `CLIENT_URL` - The URL of the frontend application (default: `http://localhost:5173`) to configure CORS.

**External Services:**
- Google Gemini API (Strictly for the Action Summary feature). No other external cloud databases or services are required.

---

## 5. Setup & Local Run Instructions (Clean Environment)

Follow these exact steps to reproduce, test, and run the application locally from scratch.

### Prerequisites
- Node.js (v18 or higher)
- npm (Node Package Manager)
- Git

### Step 1: Clone the Repository
```bash
git clone <your-private-github-repo-url>
cd campusconnect
```

### Step 2: Install Dependencies
Install dependencies for both the server and the client.
```bash
# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
cd ..
```

### Step 3: Configuration
Copy the example environment file and add your secrets.
```bash
cd server
cp .env.example .env
```
Open `server/.env` in your code editor and configure it:
```env
PORT=3001
SESSION_SECRET=your_super_secret_session_string_here
AI_API_KEY=your_google_ai_api_key_here
NODE_ENV=development
CLIENT_URL=http://localhost:5173
```

### Step 4: Start the Application
You will need two terminal windows to run the frontend and backend simultaneously.

**Terminal 1 (Backend Server):**
```bash
cd server
npm run dev
```
*(You should see "Server running on port 3001" and "Connected to SQLite database".)*

**Terminal 2 (Frontend Client):**
```bash
cd client
npm run dev
```
*(The Vite server will start, typically on port 5173.)*

### Step 5: Testing the Application
1. Open your web browser and navigate to `http://localhost:5173`.
2. **Create Account A:** Register a new user (e.g., `userA@example.com`).
3. **Open a New Browser Profile (or Incognito Window):** This ensures cookies don't overlap. Navigate to `http://localhost:5173` again.
4. **Create Account B:** Register a second user (e.g., `userB@example.com`).
5. **Start Chatting:** On Account A, use the search bar to find Account B. Click to start a conversation.
6. **Test Real-Time:** Send a message from Account A. It will appear instantly on Account B's screen without refreshing, validating the WebSocket connection.
7. **Test Media:** Click the attachment icon to send an image or file.
8. **Test Persistence:** Refresh both browsers. The chat history and session will seamlessly persist.
