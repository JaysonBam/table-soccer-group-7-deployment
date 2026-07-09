// Handles incoming API requests.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { LobbyService } from "../lobbies/lobbyService.ts";
import type { LobbySettingsUpdateRequest } from "../shared/types.ts";
import { AppError } from "../shared/errors.ts";
import type { LobbySocketServer } from "../realtime/lobbySocketServer.ts";

type LobbyRouteDependencies = {
  lobbyService: LobbyService;
  lobbySocketServer: LobbySocketServer;
};

export function createLobbyRouteHandler({ lobbyService, lobbySocketServer }: LobbyRouteDependencies) {
  return async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method === "OPTIONS") {
        sendJson(response, 204, null);
        return;
      }

      if (request.method === "GET" && request.url === "/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (request.method === "POST" && request.url === "/lobbies") {
        const body = expectObject(await readJsonBody(request), "Lobby request body is required");
        const lobbyRequest = readLobbyJoinRequest(body);
        const lobby = lobbyService.createLobby(lobbyRequest.playerName, lobbyRequest.joinChoice);

        sendJson(response, 201, lobby);
        return;
      }

      const joinCode = matchLobbyCode(request.url, /^\/lobbies\/([A-Z0-9]{6})\/join$/);

      if (request.method === "POST" && joinCode) {
        const body = expectObject(await readJsonBody(request), "Lobby request body is required");
        const lobbyRequest = readLobbyJoinRequest(body);
        const lobby = lobbyService.joinLobby(joinCode, lobbyRequest.playerName, lobbyRequest.joinChoice);

        lobbySocketServer.broadcastLobby(lobby);
        sendJson(response, 200, lobby);
        return;
      }

      const lobbyCode = matchLobbyCode(request.url, /^\/lobbies\/([A-Z0-9]{6})$/);

      if (request.method === "GET" && lobbyCode) {
        sendJson(response, 200, lobbyService.getLobby(lobbyCode));
        return;
      }

      const scoreCode = matchLobbyCode(request.url, /^\/lobbies\/([A-Z0-9]{6})\/score$/);

      if (request.method === "GET" && scoreCode) {
        sendJson(response, 200, lobbyService.getLobby(scoreCode));
        return;
      }

      if (request.method === "POST" && scoreCode) {
        const body = expectObject(await readJsonBody(request), "Score update body is required");

        if (body.action !== "reset") {
          throw new AppError(400, "Scores are updated by gameplay goals");
        }

        const lobby = lobbyService.resetMatch(scoreCode);
        lobbySocketServer.broadcastLobby(lobby);
        sendJson(response, 200, lobby);
        return;
      }

      const settingsCode = matchLobbyCode(request.url, /^\/lobbies\/([A-Z0-9]{6})\/settings$/);

      if (request.method === "POST" && settingsCode) {
        const body = expectObject(await readJsonBody(request), "Lobby update body is required");
        const lobby = lobbyService.updateLobbySettings(settingsCode, readLobbySettingsUpdateRequest(body));

        lobbySocketServer.broadcastLobby(lobby);
        sendJson(response, 200, lobby);
        return;
      }

      sendJson(response, 404, { error: "Route not found" });
    } catch (error) {
      if (error instanceof AppError) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }

      if (error instanceof Error) {
        sendJson(response, 500, { error: error.message });
        return;
      }

      sendJson(response, 500, { error: "Unknown error" });
    }
  };
}

function matchLobbyCode(requestUrl: string | undefined, pattern: RegExp): string | null {
  const match = requestUrl?.match(pattern);
  return match ? match[1] : null;
}

function readLobbyJoinRequest(body: Record<string, unknown>): { playerName: string; joinChoice: "player" | "spectator" } {
  const playerName = readRequiredString(body.playerName, "playerName is required");

  return {
    playerName,
    joinChoice: body.joinChoice === "spectator" ? "spectator" : "player"
  };
}

function readLobbySettingsUpdateRequest(body: Record<string, unknown>): LobbySettingsUpdateRequest {
  const playerId = readRequiredString(body.playerId, "playerId is required");
  const teamNames = body.teamNames === undefined ? undefined : expectObject(body.teamNames, "Request field must be an object");
  const settings = body.settings === undefined ? undefined : expectObject(body.settings, "Request field must be an object");

  return {
    playerId,
    teamNames: teamNames as LobbySettingsUpdateRequest["teamNames"],
    settings: settings as LobbySettingsUpdateRequest["settings"]
  };
}

function readRequiredString(value: unknown, errorMessage: string): string {
  if (typeof value !== "string") {
    throw new AppError(400, errorMessage);
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    throw new AppError(400, errorMessage);
  }

  return trimmedValue;
}

function sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  });
  response.end(data === null ? undefined : JSON.stringify(data));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new AppError(400, "Request body must be valid JSON");
  }
}

function expectObject(value: unknown, errorMessage: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, errorMessage);
  }

  return value as Record<string, unknown>;
}
