# ARCANA GAMBIT — Online & Local Multiplayer Edition

A cinematic, dark-fantasy casino 2-player card-and-betting game powered by **Node.js + Express + Socket.IO**.

## Features
- **Online Multiplayer Across the Internet**: Create a private table with a 6-character room code or 1-click invite link.
- **Server-Authoritative Anti-Cheat**: The Contester's chosen card is strictly stored on the Node.js server and never transmitted to the Bettor's browser until Step 4 (Showdown).
- **Local 2-Player Mode**: Still playable on a single device with a Pass-Device Privacy Curtain.
- **Complete 18-Round Engine**: 11 cards (0–10) per player, 10 starting chips, dedicated shuffled 1–9 dealer decks, alternating Contester/Bettor roles, strictly separated scoring, and Web Audio API soundscapes.

---

## Quick Start (Run Locally)
1. Make sure you have **Node.js (v18+)** installed: https://nodejs.org
2. Open a terminal inside this folder and run:
   ```bash
   npm install
   npm start
   ```
3. Open `http://localhost:3000` in your browser.

---

## How to Play With Your Friend Over the Internet

### Option 1: Fastest (Zero Deployment — 10 Seconds)
Keep `npm start` running on your computer, then open a second terminal and run either:
- **Cloudflare Tunnel (no account required):**
  ```bash
  npx cloudflared tunnel --url http://localhost:3000
  ```
- **Or ngrok:**
  ```bash
  ngrok http 3000
  ```
Copy the generated `https://...` URL, open it, click **PLAY ONLINE → CREATE TABLE**, and send the **Copy Invite Link** to your friend!

### Option 2: Free Permanent Hosting (Render.com or Railway.app)
1. Upload this folder to a GitHub repository.
2. Go to [Render.com](https://render.com) → **New Web Service** → connect your repo.
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Deploy and share your live `https://your-app.onrender.com` link with your friend!
