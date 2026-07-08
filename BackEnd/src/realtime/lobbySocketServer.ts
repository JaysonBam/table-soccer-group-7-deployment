// Handles realtime lobby WebSocket messages.

import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  createKickBallMovementState,
  createKickoffPauseBallMovementState,
  createRoundResetBallMovementState,
  createStoppedBallMovementState,
  getBallPositionAt,
  getBallSpeed,
  getNextBallBoundaryEvent
} from "../gameplay/ballMovement.ts";
import type { LobbyService } from "../lobbies/lobbyService.ts";
import { SOCCER_DEAD_BALL, SOCCER_KICKOFF_PAUSE_MS, SOCCER_KICK_TUNING, SOCCER_PLAYER_HORIZONTAL_RANGE } from "../shared/constants.ts";
import type { AssignedPlayer, BallMovementState, ClientSocketMessage, Lobby, PlayerTeam, ServerSocketMessage, TeamSide, Vector2D } from "../shared/types.ts";
import { TEAM_CONFIG } from "../shared/types.ts";
import { AppError } from "../shared/errors.ts";

type LobbyConnection = {
  socket: WebSocket;
  lobbyCode: string;
  playerId: string;
};

type LobbyConnectionRequest = {
  lobby: Lobby;
  playerId: string;
};

export type LobbySocketServer = {
  broadcastLobby: (lobby: Lobby) => void;
};

export function createLobbySocketServer(server: Server, lobbyService: LobbyService): LobbySocketServer {
  const webSocketServer = new WebSocketServer({ noServer: true });
  const lobbyConnections = new Map<string, Set<LobbyConnection>>();
  const lobbyPositions = new Map<string, Map<string, number>>();
  const lobbyBallStates = new Map<string, BallMovementState>();
  const lobbyBallTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lobbyMatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lobbyLastKickAt = new Map<string, number>();

  server.on("upgrade", (request, socket, head) => {
    const connectionRequest = readConnectionRequest(request.url, request.headers.host, lobbyService);

    if (!connectionRequest) {
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      connectLobbyClient(webSocket, connectionRequest.lobby, connectionRequest.playerId);
    });
  });

  return {
    broadcastLobby
  };

  function connectLobbyClient(socket: WebSocket, lobby: Lobby, playerId: string): void {
    const currentLobby = lobbyService.getLobby(lobby.code);
    const connection: LobbyConnection = {
      socket,
      lobbyCode: currentLobby.code,
      playerId
    };
    const connections = lobbyConnections.get(currentLobby.code) ?? new Set<LobbyConnection>();

    connections.add(connection);
    lobbyConnections.set(currentLobby.code, connections);
    scheduleMatchFinish(currentLobby);
    startBallIfNeeded(currentLobby);
    sendMessage(connection, { type: "lobby", lobby: lobbyService.getLobby(currentLobby.code) });
    sendMessage(connection, { type: "positions", positions: Object.fromEntries(lobbyPositions.get(currentLobby.code) ?? []) });

    const ballState = lobbyBallStates.get(currentLobby.code);

    if (ballState) {
      sendMessage(connection, {
        type: "ballState",
        ball: ballState
      });
    }

    socket.on("message", (data) => handleClientMessage(connection, data));
    socket.on("close", () => removeConnection(connection));
    socket.on("error", () => removeConnection(connection));
  }

  function handleClientMessage(connection: LobbyConnection, data: WebSocket.RawData): void {
    try {
      const message = parseClientMessage(data);

      switch (message.type) {
        case "ready": {
          const lobby = lobbyService.markPlayerReady(connection.lobbyCode, connection.playerId);

          broadcastLobby(lobby);
          startBallIfNeeded(lobby);
          return;
        }
        case "position": {
          const position = setPlayerPosition(connection.lobbyCode, connection.playerId, message.position);

          broadcastToLobby(connection.lobbyCode, {
            type: "position",
            playerId: connection.playerId,
            position
          });
          return;
        }
        case "cheer":
          assertSpectatorCheerAllowed(connection, message.team);
          broadcastCheerToTeam(connection.lobbyCode, message.team, {
            type: "cheer",
            team: message.team
          });
          return;
        case "kick":
          handleKickMessage(connection, message);
          return;
      }
    } catch (error) {
      sendMessage(connection, {
        type: "error",
        message: error instanceof Error ? error.message : "Invalid socket message"
      });
    }
  }

  function removeConnection(connection: LobbyConnection): void {
    const connections = lobbyConnections.get(connection.lobbyCode);

    if (!connections) {
      return;
    }

    connections.delete(connection);

    if (connections.size === 0) {
      lobbyConnections.delete(connection.lobbyCode);
    }
  }

  function broadcastLobby(lobby: Lobby): void {
    scheduleMatchFinish(lobby);
    clearBallStateIfWaiting(lobby);
    broadcastToLobby(lobby.code, { type: "lobby", lobby });
  }

  function clearBallStateIfWaiting(lobby: Lobby): void {
    if (lobby.assignments) {
      return;
    }

    const existingTimer = lobbyBallTimers.get(lobby.code);

    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    lobbyBallTimers.delete(lobby.code);
    lobbyBallStates.delete(lobby.code);
    lobbyLastKickAt.delete(lobby.code);
  }

  function startBallIfNeeded(lobby: Lobby): void {
    if (!lobby.assignments || lobby.match?.status !== "active" || lobbyBallStates.has(lobby.code)) {
      return;
    }

    publishBallState(lobby.code, createKickoffPauseBallMovementState(1));
  }

  function publishBallState(lobbyCode: string, ballState: BallMovementState): void {
    lobbyBallStates.set(lobbyCode, ballState);
    broadcastToLobby(lobbyCode, { type: "ballState", ball: ballState });
    scheduleNextBallEvent(lobbyCode, ballState);
  }

  function scheduleNextBallEvent(lobbyCode: string, ballState: BallMovementState): void {
    const existingTimer = lobbyBallTimers.get(lobbyCode);

    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const lobby = lobbyService.getLobby(lobbyCode);

    if (lobby.match?.status !== "active") {
      lobbyBallTimers.delete(lobbyCode);
      return;
    }

    if (getBallSpeed(ballState) <= SOCCER_DEAD_BALL.speedThreshold) {
      scheduleDeadBallReset(lobbyCode, ballState);
      return;
    }

    const nextBallEvent = getNextBallBoundaryEvent(ballState);

    if (!nextBallEvent) {
      lobbyBallTimers.delete(lobbyCode);
      return;
    }

    const timer = setTimeout(() => {
      const currentBallState = lobbyBallStates.get(lobbyCode);
      const currentLobby = lobbyService.getLobby(lobbyCode);

      if (!currentBallState || currentBallState.sequence !== ballState.sequence || currentLobby.match?.status !== "active") {
        return;
      }

      if (nextBallEvent.type === "wall-bounce") {
        publishBallState(lobbyCode, nextBallEvent.ballState);
        return;
      }

      handleGoal(lobbyCode, nextBallEvent.scoringTeam, nextBallEvent.timestamp);
    }, Math.max(0, nextBallEvent.timestamp - Date.now()));

    lobbyBallTimers.set(lobbyCode, timer);
  }

  function scheduleDeadBallReset(lobbyCode: string, ballState: BallMovementState): void {
    const delayMs = ballState.reason === "kickoff-pause" ? SOCCER_KICKOFF_PAUSE_MS : SOCCER_DEAD_BALL.respawnDelayMs;
    const timer = setTimeout(() => {
      const currentBallState = lobbyBallStates.get(lobbyCode);
      const lobby = lobbyService.getLobby(lobbyCode);

      if (!currentBallState || currentBallState.sequence !== ballState.sequence || lobby.match?.status !== "active") {
        return;
      }

      publishBallState(lobbyCode, createRoundResetBallMovementState(ballState.sequence + 1));
    }, delayMs);

    lobbyBallTimers.set(lobbyCode, timer);
  }

  function handleGoal(lobbyCode: string, scoringTeam: TeamSide, scoredAt: number): void {
    let lobby: Lobby;

    try {
      lobby = lobbyService.recordGoal(lobbyCode, scoringTeam, scoredAt);
    } catch (error) {
      if (error instanceof AppError) {
        return;
      }

      throw error;
    }

    broadcastLobby(lobby);
    broadcastToLobby(lobbyCode, { type: "goal", scoringTeam });

    if (lobby.match?.status === "active") {
      const currentBallState = lobbyBallStates.get(lobbyCode);
      const nextSequence = (currentBallState?.sequence ?? 0) + 1;

      publishBallState(lobbyCode, createKickoffPauseBallMovementState(nextSequence));
      return;
    }

    publishStoppedBall(lobbyCode);
  }

  function publishStoppedBall(lobbyCode: string): void {
    const currentBallState = lobbyBallStates.get(lobbyCode);

    if (!currentBallState) {
      return;
    }

    publishBallState(lobbyCode, createStoppedBallMovementState(currentBallState));
  }

  function scheduleMatchFinish(lobby: Lobby): void {
    const existingTimer = lobbyMatchTimers.get(lobby.code);

    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    if (lobby.match?.status !== "active") {
      lobbyMatchTimers.delete(lobby.code);
      return;
    }

    const timer = setTimeout(() => {
      const updatedLobby = lobbyService.finishExpiredMatch(lobby.code, Date.now());

      if (updatedLobby.match?.status === "active") {
        scheduleMatchFinish(updatedLobby);
        return;
      }

      broadcastLobby(updatedLobby);
      publishStoppedBall(lobby.code);
    }, Math.max(0, lobby.match.endsAt - Date.now()));

    lobbyMatchTimers.set(lobby.code, timer);
  }

  function handleKickMessage(connection: LobbyConnection, message: Extract<ClientSocketMessage, { type: "kick" }>): void {
    if (message.distance < SOCCER_KICK_TUNING.minSwipeDistance) {
      return;
    }

    const now = Date.now();
    const lobby = lobbyService.getLobby(connection.lobbyCode);

    if (!lobby.assignments || lobby.match?.status !== "active") {
      return;
    }

    const requesterAssignment = lobby.assignments.find((assignment) => assignment.id === connection.playerId);

    if (!requesterAssignment) {
      return;
    }

    const lastKickAt = lobbyLastKickAt.get(connection.lobbyCode);

    if (lastKickAt !== undefined && now - lastKickAt < SOCCER_KICK_TUNING.cooldownMs) {
      return;
    }

    const ballState = lobbyBallStates.get(connection.lobbyCode);

    if (!ballState) {
      return;
    }

    if (message.playerPosition !== undefined) {
      const position = setPlayerPosition(connection.lobbyCode, connection.playerId, message.playerPosition);

      broadcastToLobby(connection.lobbyCode, {
        type: "position",
        playerId: connection.playerId,
        position
      });
    }

    const kickTimestamp = getCompensatedKickTimestamp(message.clientTimestamp, ballState, now);
    const ballPosition = getBallPositionAt(ballState, kickTimestamp);
    const closestPlayer = findClosestEligibleKickPlayer(lobby, requesterAssignment, ballPosition, ballState);

    if (!closestPlayer) {
      return;
    }

    const nextBallState = createKickBallMovementState(
      ballState,
      getWorldKickDirection(closestPlayer.team, message.direction),
      message.distance,
      message.velocity,
      kickTimestamp
    );

    if (!nextBallState) {
      return;
    }

    lobbyLastKickAt.set(connection.lobbyCode, now);
    lobbyService.recordBallTouch(connection.lobbyCode, closestPlayer.id, kickTimestamp);
    publishBallState(connection.lobbyCode, nextBallState);
  }

  function getCompensatedKickTimestamp(
    clientTimestamp: number | undefined,
    ballState: BallMovementState,
    now: number
  ): number {
    if (clientTimestamp === undefined) {
      return now;
    }

    const earliestTimestamp = Math.max(
      ballState.serverTimestamp,
      now - SOCCER_KICK_TUNING.maxLatencyCompensationMs
    );

    return Math.max(earliestTimestamp, Math.min(now, clientTimestamp));
  }

  function findClosestEligibleKickPlayer(
    lobby: Lobby,
    requesterAssignment: AssignedPlayer,
    ballPosition: Vector2D,
    ballState: BallMovementState
  ): AssignedPlayer | null {
    const positions = lobbyPositions.get(lobby.code);
    const kickRadiusSquared = SOCCER_KICK_TUNING.kickRadius * SOCCER_KICK_TUNING.kickRadius;
    const playerPosition = getAssignedPlayerPosition(
      requesterAssignment,
      positions?.get(requesterAssignment.id),
      ballState
    );
    const distanceSquared = getDistanceSquared(ballPosition, playerPosition);

    if (distanceSquared > kickRadiusSquared) {
      return null;
    }

    return requesterAssignment;
  }

  function getAssignedPlayerPosition(
    assignment: AssignedPlayer,
    playerPosition: number | undefined,
    ballState: BallMovementState
  ): Vector2D {
    const horizontalPosition = Math.max(-1, Math.min(1, playerPosition ?? assignment.horizontalSlot));

    return {
      x: (assignment.verticalLane / 100) * ballState.field.width,
      y: ballState.field.height * (0.5 + horizontalPosition * SOCCER_PLAYER_HORIZONTAL_RANGE)
    };
  }

  function getWorldKickDirection(team: PlayerTeam, localDirection: Vector2D): Vector2D {
    if (team === TEAM_CONFIG.team1.playerTeam) {
      return {
        x: localDirection.y,
        y: localDirection.x
      };
    }

    return {
      x: -localDirection.y,
      y: -localDirection.x
    };
  }

  function broadcastToLobby(lobbyCode: string, message: ServerSocketMessage): void {
    const connections = lobbyConnections.get(lobbyCode);

    if (!connections) {
      return;
    }

    for (const connection of connections) {
      sendMessage(connection, message);
    }
  }

  function broadcastCheerToTeam(lobbyCode: string, team: PlayerTeam, message: ServerSocketMessage): void {
    const connections = lobbyConnections.get(lobbyCode);

    if (!connections) {
      return;
    }

    const lobby = lobbyService.getLobby(lobbyCode);
    const teamPlayerIds = new Set(
      lobby.assignments
        ?.filter((assignment) => assignment.team === team)
        .map((assignment) => assignment.id) ?? []
    );

    for (const connection of connections) {
      if (!teamPlayerIds.has(connection.playerId)) {
        continue;
      }

      sendMessage(connection, message);
    }
  }

  function sendMessage(connection: LobbyConnection, message: ServerSocketMessage): void {
    if (connection.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      connection.socket.send(JSON.stringify(message));
    } catch {
      removeConnection(connection);
      connection.socket.close();
    }
  }

  function setPlayerPosition(lobbyCode: string, playerId: string, position: number): number {
    const lobby = lobbyService.getLobby(lobbyCode);

    if (!lobby.players.some((player) => player.id === playerId)) {
      throw new AppError(404, "Player not found");
    }

    const clampedPosition = Math.max(-1, Math.min(1, position));
    const positions = lobbyPositions.get(lobbyCode) ?? new Map<string, number>();

    positions.set(playerId, clampedPosition);
    lobbyPositions.set(lobbyCode, positions);

    return clampedPosition;
  }

  function assertSpectatorCheerAllowed(connection: LobbyConnection, team: PlayerTeam): void {
    const lobby = lobbyService.getLobby(connection.lobbyCode);
    const sender = lobby.players.find((player) => player.id === connection.playerId);

    if (!sender) {
      throw new AppError(404, "Player not found");
    }

    if (sender.joinChoice !== "spectator") {
      throw new AppError(400, "Only spectators can cheer");
    }

    if (!lobby.assignments?.some((assignment) => assignment.team === team)) {
      throw new AppError(400, "Cannot cheer before the game starts");
    }
  }
}

function readConnectionRequest(
  requestUrl: string | undefined,
  host: string | undefined,
  lobbyService: LobbyService
): LobbyConnectionRequest | null {
  try {
    const url = new URL(requestUrl ?? "/", `http://${host ?? "localhost"}`);
    const match = url.pathname.match(/^\/lobbies\/([A-Z0-9]{6})\/socket$/);
    const playerId = url.searchParams.get("playerId")?.trim();

    if (!match || !playerId) {
      return null;
    }

    const lobby = lobbyService.getLobby(match[1]);

    if (!lobby.players.some((player) => player.id === playerId)) {
      return null;
    }

    return {
      lobby,
      playerId
    };
  } catch {
    return null;
  }
}

function parseClientMessage(data: WebSocket.RawData): ClientSocketMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(data.toString());
  } catch {
    throw new AppError(400, "Socket message must be valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(400, "Unknown socket message type");
  }

  const message = parsed as Record<string, unknown>;

  if (message.type === "ready") {
    return { type: "ready" };
  }

  if (message.type === "position") {
    return {
      type: "position",
      position: readFiniteNumber(message.position, "position")
    };
  }

  if ((message.team === "team1Player" || message.team === "team2Player") && message.type === "cheer") {
    return {
      type: "cheer",
      team: message.team
    };
  }

  if (message.type === "kick") {
    return {
      type: "kick",
      direction: readVector(message.direction, "direction"),
      distance: readNonNegativeNumber(message.distance, "distance"),
      velocity: readNonNegativeNumber(message.velocity, "velocity"),
      clientTimestamp: message.clientTimestamp === undefined
        ? undefined
        : readNonNegativeNumber(message.clientTimestamp, "clientTimestamp"),
      playerPosition: message.playerPosition === undefined
        ? undefined
        : readFiniteNumber(message.playerPosition, "playerPosition")
    };
  }

  throw new AppError(400, "Unknown socket message type");
}

function readVector(value: unknown, fieldName: string): Vector2D {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, `${fieldName} must be a vector`);
  }

  const vector = value as Record<string, unknown>;

  return {
    x: readFiniteNumber(vector.x, `${fieldName}.x`),
    y: readFiniteNumber(vector.y, `${fieldName}.y`)
  };
}

function readNonNegativeNumber(value: unknown, fieldName: string): number {
  const numberValue = readFiniteNumber(value, fieldName);

  if (numberValue < 0) {
    throw new AppError(400, `${fieldName} must be non-negative`);
  }

  return numberValue;
}

function readFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AppError(400, `${fieldName} must be a number`);
  }

  return value;
}

function getDistanceSquared(first: Vector2D, second: Vector2D): number {
  const xDistance = first.x - second.x;
  const yDistance = first.y - second.y;

  return xDistance * xDistance + yDistance * yDistance;
}
