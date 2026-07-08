import { FALLBACK_WS_URL, WS_URL } from "./config";
import {
  recordSocketClose,
  recordSocketDropped,
  recordSocketError,
  recordSocketFallback,
  recordSocketMessage,
  recordSocketOpen,
  recordSocketPendingFlush,
  recordSocketQueued,
  recordSocketSend
} from "./diagnostics";
import type { BallMovementState, FoosballTeam, KickRequest, Lobby, TeamSide } from "./types";

type LobbySocketMessage =
  | {
      type: "lobby";
      lobby: Lobby;
    }
  | {
      type: "positions";
      positions: Record<string, number>;
    }
  | {
      type: "position";
      playerId: string;
      position: number;
    }
  | {
      type: "cheer";
      team: FoosballTeam;
    }
  | {
      type: "ballState";
      ball: BallMovementState;
    }
  | {
      type: "goal";
      scoringTeam: TeamSide;
    }
  | {
      type: "error";
      message: string;
    };

type ClientSocketMessage =
  | {
      type: "ready";
    }
  | {
      type: "position";
      position: number;
    }
  | {
      type: "cheer";
      team: FoosballTeam;
    }
  | {
      type: "kick";
      direction: KickRequest["direction"];
      distance: number;
      velocity: number;
      clientTimestamp?: number;
      playerPosition?: number;
    };

type LobbySocketHandlers = {
  onLobby: (lobby: Lobby) => void;
  onPositions: (positions: Record<string, number>) => void;
  onPosition: (playerId: string, position: number) => void;
  onCheer: (team: FoosballTeam) => void;
  onBallState: (ball: BallMovementState) => void;
  onGoal: (scoringTeam: TeamSide) => void;
  onError: (message: string) => void;
};

export type LobbySocketConnection = {
  markReady: () => void;
  sendPosition: (position: number) => void;
  sendCheer: (team: FoosballTeam) => void;
  sendKick: (kick: KickRequest) => void;
  close: () => void;
};

export function connectLobbySocket(
  lobbyCode: string,
  playerId: string,
  handlers: LobbySocketHandlers
): LobbySocketConnection {
  const pendingMessages: ClientSocketMessage[] = [];
  const socketUrls = getSocketUrls(lobbyCode, playerId);
  let closedByClient = false;
  let socket: WebSocket;
  let socketGeneration = 0;

  openSocket(0);

  const sendMessage = (message: ClientSocketMessage): void => {
    if (socket.readyState === WebSocket.OPEN) {
      recordSocketSend(message.type, socket.readyState);
      socket.send(JSON.stringify(message));
      return;
    }

    if (socket.readyState === WebSocket.CONNECTING) {
      recordSocketQueued(message.type, socket.readyState);
      pendingMessages.push(message);
      return;
    }

    recordSocketDropped(message.type, socket.readyState);
  };

  return {
    markReady: () => sendMessage({ type: "ready" }),
    sendPosition: (position: number) => sendMessage({ type: "position", position }),
    sendCheer: (team: FoosballTeam) => sendMessage({ type: "cheer", team }),
    sendKick: (kick: KickRequest) => sendMessage({ type: "kick", ...kick }),
    close: () => {
      closedByClient = true;
      socket.close();
    }
  };

  function openSocket(urlIndex: number): void {
    const generation = ++socketGeneration;
    const nextSocket = new WebSocket(socketUrls[urlIndex]);
    let opened = false;
    let fallbackStarted = false;

    socket = nextSocket;

    nextSocket.addEventListener("open", () => {
      if (generation !== socketGeneration) {
        return;
      }

      opened = true;
      recordSocketOpen(urlIndex, nextSocket.readyState);

      while (pendingMessages.length > 0 && nextSocket.readyState === WebSocket.OPEN) {
        const pendingMessage = pendingMessages.shift();

        if (!pendingMessage) {
          continue;
        }

        recordSocketPendingFlush(1);
        recordSocketSend(pendingMessage.type, nextSocket.readyState);
        nextSocket.send(JSON.stringify(pendingMessage));
      }
    });

    nextSocket.addEventListener("message", (event) => {
      if (generation !== socketGeneration) {
        return;
      }

      try {
        const message = JSON.parse(String(event.data)) as LobbySocketMessage;

        recordSocketMessage(message.type);
        handleSocketMessage(message, handlers);
      } catch {
        recordSocketError("Received an invalid lobby socket message.", nextSocket.readyState);
        handlers.onError("Received an invalid lobby socket message.");
      }
    });

    nextSocket.addEventListener("error", () => {
      if (generation !== socketGeneration) {
        return;
      }

      if (!opened && urlIndex + 1 < socketUrls.length) {
        fallbackStarted = true;
        recordSocketFallback();
        openSocket(urlIndex + 1);
        nextSocket.close();
        return;
      }

      recordSocketError("Lobby socket connection failed.", nextSocket.readyState);
      handlers.onError("Lobby socket connection failed.");
    });

    nextSocket.addEventListener("close", (event) => {
      recordSocketClose(event.code, nextSocket.readyState);

      if (generation !== socketGeneration || closedByClient) {
        return;
      }

      if (!opened && !fallbackStarted && urlIndex + 1 < socketUrls.length) {
        recordSocketFallback();
        openSocket(urlIndex + 1);
        return;
      }

      handlers.onError("Lobby socket connection closed.");
    });
  }
}

function getSocketUrls(lobbyCode: string, playerId: string): string[] {
  const socketPath = `/lobbies/${lobbyCode}/socket?playerId=${encodeURIComponent(playerId)}`;
  const urls = [`${WS_URL}${socketPath}`];
  const fallbackUrl = FALLBACK_WS_URL ? `${FALLBACK_WS_URL}${socketPath}` : "";

  if (fallbackUrl && fallbackUrl !== urls[0]) {
    urls.push(fallbackUrl);
  }

  return urls;
}

function handleSocketMessage(message: LobbySocketMessage, handlers: LobbySocketHandlers): void {
  switch (message.type) {
    case "lobby":
      handlers.onLobby(message.lobby);
      break;
    case "positions":
      handlers.onPositions(message.positions);
      break;
    case "position":
      handlers.onPosition(message.playerId, message.position);
      break;
    case "cheer":
      handlers.onCheer(message.team);
      break;
    case "ballState":
      handlers.onBallState(message.ball);
      break;
    case "goal":
      handlers.onGoal(message.scoringTeam);
      break;
    case "error":
      handlers.onError(message.message);
      break;
  }
}
