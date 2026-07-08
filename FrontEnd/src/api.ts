import { API_URL, FALLBACK_API_URL } from "./config";
import type { Lobby, LobbyRequest, LobbySettingsUpdateRequest, ScoreUpdateRequest } from "./types";

export async function createLobby(request: LobbyRequest): Promise<Lobby> {
  return postLobby("/lobbies", request);
}

export async function joinLobby(lobbyCode: string, request: LobbyRequest): Promise<Lobby> {
  return postLobby(`/lobbies/${lobbyCode}/join`, request);
}

export async function getLobby(lobbyCode: string): Promise<Lobby> {
  return requestLobby(`/lobbies/${lobbyCode}`);
}

export async function updateLobbyScore(lobbyCode: string, request: ScoreUpdateRequest): Promise<Lobby> {
  return requestLobby(`/lobbies/${lobbyCode}/score`, request);
}

export async function updateLobbySettings(lobbyCode: string, request: LobbySettingsUpdateRequest): Promise<Lobby> {
  return requestLobby(`/lobbies/${lobbyCode}/settings`, request);
}

export async function returnLobbyToWaitingRoom(lobbyCode: string, playerId: string): Promise<Lobby> {
  return requestLobby(`/lobbies/${lobbyCode}/waiting-room`, { playerId });
}

async function postLobby(path: string, body: LobbyRequest): Promise<Lobby> {
  return requestLobby(path, { playerName: body.personName, joinChoice: body.joinChoice });
}

async function requestLobby(path: string, body?: unknown): Promise<Lobby> {
  try {
    return await requestLobbyFrom(API_URL, path, body);
  } catch (error) {
    if (API_URL === "" && FALLBACK_API_URL && isProxyMissError(error)) {
      return requestLobbyFrom(FALLBACK_API_URL, path, body);
    }

    throw error;
  }
}

async function requestLobbyFrom(baseUrl: string, path: string, body?: unknown): Promise<Lobby> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const responseText = await response.text();
  const data = readJsonResponse(responseText, path) as Partial<Lobby> & { error?: string };

  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }

  return data as Lobby;
}

function isProxyMissError(error: unknown): boolean {
  return error instanceof Error
    && (error.message.startsWith("Empty response") || error.message.startsWith("Unexpected non-JSON response"));
}

function readJsonResponse(responseText: string, path: string): unknown {
  if (!responseText.trim()) {
    throw new Error(`Empty response from ${path}. Check that the backend is running and VITE_API_URL is set for deployed frontends.`);
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(`Unexpected non-JSON response from ${path}. Check VITE_API_URL, or restart the frontend dev server so Vite loads its proxy config.`);
  }
}
