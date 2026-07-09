import { WebSocket } from "ws";

const API_URL = process.env.API_URL ?? "http://localhost:3000";
const WS_URL = process.env.WS_URL ?? "ws://localhost:3000";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://127.0.0.1:5173/#/lobby";
const BOT_COUNT = Number(process.env.BOT_COUNT ?? 5);
const READY_BOT_COUNT = Number(process.env.READY_BOT_COUNT ?? 2);
const WIN_TARGET = Number(process.env.WIN_TARGET ?? 5);
const TIMER_SECONDS = Number(process.env.TIMER_SECONDS ?? 300);

async function main() {
  if (!Number.isInteger(BOT_COUNT) || BOT_COUNT < 1) {
    throw new Error("BOT_COUNT must be a positive integer");
  }

  if (!Number.isInteger(READY_BOT_COUNT) || READY_BOT_COUNT < 0) {
    throw new Error("READY_BOT_COUNT must be a non-negative integer");
  }

  const botNames = createBotNames(BOT_COUNT);
  const [hostName, ...guestNames] = botNames;
  const lobby = await createLobby(hostName);
  const updatedLobby = await updateLobbySettings(lobby.code, lobby.hostId, {
    mode: "firstTo",
    winTarget: WIN_TARGET,
    timerSeconds: TIMER_SECONDS
  });
  const players = [...updatedLobby.players];

  for (const guestName of guestNames) {
    const joinedLobby = await joinLobby(lobby.code, guestName);
    const joinedPlayer = joinedLobby.players.find((player) => player.name === guestName);

    if (!joinedPlayer) {
      throw new Error(`Could not find joined player ${guestName}`);
    }

    players.push(joinedPlayer);
  }

  const sockets = players.map((player) => connectLobbySocket(lobby.code, player.id, player.name));
  await waitForSocketsToOpen(sockets);

  for (const socket of sockets.slice(0, Math.min(READY_BOT_COUNT, sockets.length))) {
    socket.send(JSON.stringify({ type: "ready" }));
  }

  console.log(`LOBBY_CODE=${lobby.code}`);
  console.log(`JOIN_URL=${FRONTEND_URL}`);
  console.log(`BOT_COUNT=${BOT_COUNT}`);
  console.log(`READY_BOTS=${READY_BOT_COUNT}`);
  console.log(`WIN_TARGET=${WIN_TARGET}`);
  console.log(`TIMER_SECONDS=${TIMER_SECONDS}`);
  console.log(`PLAYERS=${players.map((player) => `${player.name}:${player.id}`).join(",")}`);

  const shutdown = () => {
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }

    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function createBotNames(botCount) {
  return Array.from({ length: botCount }, (_, index) => (index === 0 ? "BotHost" : `Bot${index + 1}`));
}

async function createLobby(playerName) {
  return postJson("/lobbies", { playerName, joinChoice: "player" });
}

async function joinLobby(lobbyCode, playerName) {
  return postJson(`/lobbies/${lobbyCode}/join`, { playerName, joinChoice: "player" });
}

async function updateLobbySettings(lobbyCode, playerId, settings) {
  return postJson(`/lobbies/${lobbyCode}/settings`, { playerId, settings });
}

async function postJson(path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? `Request failed for ${path}`);
  }

  return data;
}

function connectLobbySocket(lobbyCode, playerId, playerName) {
  const socket = new WebSocket(`${WS_URL}/lobbies/${lobbyCode}/socket?playerId=${encodeURIComponent(playerId)}`);

  socket.on("message", (rawData) => {
    const message = JSON.parse(String(rawData));

    if (message.type === "error") {
      console.error(`socket-error ${playerName}: ${message.message}`);
    }
  });

  return socket;
}

async function waitForSocketsToOpen(sockets) {
  await Promise.all(sockets.map((socket) => new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) {
      resolve(undefined);
      return;
    }

    socket.once("open", () => resolve(undefined));
    socket.once("error", reject);
  })));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
