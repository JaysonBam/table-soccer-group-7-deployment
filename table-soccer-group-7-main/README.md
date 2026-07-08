# Table Soccer Group 7

This repository contains a simple multiplayer table soccer project with a browser frontend and a TypeScript backend.

## What it currently does

- Creates and joins lobbies over HTTP
- Shows a waiting room with player, spectator, captain, team name, and match setting state
- Starts a match once enough players join and enough players are ready
- Moves live lobby and game communication to WebSockets after players are in a lobby
- Tracks score, ready state, team assignments, and server-side ball movement

## Repository structure

- `FrontEnd`: browser client
- `BackEnd`: HTTP and WebSocket backend

## Launch

1. Start the backend:

```bash
cd BackEnd
npm install
npm run dev
```

The backend runs on `http://localhost:3000`.

2. Start the frontend in a second terminal:

```bash
cd FrontEnd
npm install
npm run dev
```

The frontend runs on `http://127.0.0.1:5173`. When testing on phones, open the Vite network URL, for example `http://192.168.x.x:5173/#/lobby`; the frontend proxies `/lobbies` HTTP and WebSocket traffic to the backend so mobile clients use the same origin for live updates.

3. Open the app:

```text
http://127.0.0.1:5173/#/lobby
```

## Backend structure

- `BackEnd/src/api`: HTTP route handling
- `BackEnd/src/realtime`: WebSocket handling
- `BackEnd/src/lobbies`: lobby and match state rules
- `BackEnd/src/gameplay`: gameplay and movement logic
- `BackEnd/src/shared`: shared types, constants, and shared error class

## Backend docs

- `BackEnd/agent.md`: quick guide for where new backend changes should go

## Deployment

Deploy this as two services:

- Frontend: Vercel static Vite app from the `FrontEnd` directory
- Backend: Render Node web service from the `BackEnd` directory

### Render backend

This repo includes `render.yaml` for the backend web service.

Manual Render settings, if you do not use the blueprint:

- Root directory: `BackEnd`
- Runtime: Node
- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Health check path: `/health`

The backend reads `PORT` from Render and binds to `0.0.0.0` by default.

### Vercel frontend

Create the Vercel project with `FrontEnd` as the root directory. The frontend includes `FrontEnd/vercel.json` with the production build command, output directory, and SPA rewrite.

Set this Vercel environment variable after the Render backend has a public URL:

```text
VITE_API_URL=https://your-render-service.onrender.com
```

`VITE_WS_URL` is optional. If it is not set, the frontend derives the WebSocket URL from `VITE_API_URL`, for example `wss://your-render-service.onrender.com`.

### Local production checks

```bash
cd BackEnd
npm ci
npm run build
npm start
```

In another terminal:

```bash
cd FrontEnd
npm ci
npm run build
npm run preview
```
