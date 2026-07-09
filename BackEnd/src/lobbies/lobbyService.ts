// Manages lobby state and lobby rules.

import { randomUUID } from "node:crypto";
import { assignSoccerTeams } from "../gameplay/assignSoccerTeams.ts";
import { DEFAULT_GAME_SETTINGS, DEFAULT_TEAM_NAMES, EMPTY_CAPTAINS, EMPTY_SCORE, MAX_ACTIVE_PLAYERS, TEAM_PLAYER_LIMIT } from "../shared/constants.ts";
import type { AssignedPlayer, Captains, GameSettings, JoinChoice, Lobby, LobbySettingsUpdateRequest, MatchFinishReason, MatchState, Player, PlayerStats, PlayerTeam, TeamNames, TeamSide } from "../shared/types.ts";
import { getActivePlayers, TEAM_CONFIG, TEAM_SIDES } from "../shared/types.ts";
import { AppError } from "../shared/errors.ts";

export type LobbyService = {
  createLobby: (playerName: string, joinChoice: JoinChoice) => Lobby;
  joinLobby: (code: string, playerName: string, joinChoice: JoinChoice) => Lobby;
  getLobby: (code: string) => Lobby;
  recordBallTouch: (code: string, playerId: string, touchedAt?: number) => Lobby;
  recordGoal: (code: string, team: TeamSide, scoredAt?: number) => Lobby;
  resetMatch: (code: string) => Lobby;
  finishExpiredMatch: (code: string, now?: number) => Lobby;
  updateLobbySettings: (code: string, update: LobbySettingsUpdateRequest) => Lobby;
  markPlayerReady: (code: string, playerId: string) => Lobby;
};

export function createLobbyService(): LobbyService {
  const lobbies = new Map<string, Lobby>();
  const lobbyLastCountedTouch = new Map<string, { playerId: string; touchedAt: number }>();

  return {
    createLobby,
    joinLobby,
    getLobby,
    recordBallTouch,
    recordGoal,
    resetMatch,
    finishExpiredMatch,
    updateLobbySettings,
    markPlayerReady
  };

  function createLobby(playerName: string, joinChoice: JoinChoice): Lobby {
    const hostPlayer = createPlayer(playerName, joinChoice);
    const lobby: Lobby = {
      code: createLobbyCode(lobbies),
      players: [hostPlayer],
      score: { ...EMPTY_SCORE },
      hostId: hostPlayer.id,
      captains: { ...EMPTY_CAPTAINS },
      teamNames: { ...DEFAULT_TEAM_NAMES },
      settings: { ...DEFAULT_GAME_SETTINGS },
      playerStats: {},
      lastTouchPlayerId: null
    };

    syncLobbyLeaders(lobby);
    lobbies.set(lobby.code, lobby);
    return lobby;
  }

  function joinLobby(code: string, playerName: string, joinChoice: JoinChoice): Lobby {
    const lobby = getLobby(code);

    if (lobby.assignments) {
      throw new AppError(409, "Game has already started");
    }

    if (joinChoice === "player" && getActivePlayers(lobby.players).length >= MAX_ACTIVE_PLAYERS) {
      throw new AppError(409, "Player limit reached");
    }

    lobby.players.push(createPlayer(playerName, joinChoice));
    syncLobbyLeaders(lobby);
    return lobby;
  }

  function getLobby(code: string): Lobby {
    const lobby = getStoredLobby(code);

    syncLobbyLeaders(lobby);
    finishMatchIfExpired(lobby, Date.now());
    return lobby;
  }

  function getStoredLobby(code: string): Lobby {
    const lobby = lobbies.get(code);

    if (!lobby) {
      throw new AppError(404, "Lobby not found");
    }

    return lobby;
  }

  function recordGoal(code: string, team: TeamSide, scoredAt = Date.now()): Lobby {
    const lobby = getStoredLobby(code);

    assertMatchActive(lobby, scoredAt);
    lobby.score[team] += 1;
    recordGoalStats(lobby, team);

    if (isTargetScoreReached(lobby, team)) {
      finishMatch(lobby, "target-score", team, scoredAt);
    }

    return lobby;
  }

  function resetMatch(code: string): Lobby {
    const lobby = getLobby(code);

    lobby.score = { ...EMPTY_SCORE };

    if (lobby.assignments) {
      initializePlayerStats(lobby);
      lobby.lastTouchPlayerId = null;
      lobbyLastCountedTouch.delete(code);
      lobby.match = createActiveMatch(lobby.settings, Date.now());
    }

    return lobby;
  }

  function finishExpiredMatch(code: string, now = Date.now()): Lobby {
    const lobby = getStoredLobby(code);

    finishMatchIfExpired(lobby, now);
    return lobby;
  }

  function updateLobbySettings(code: string, update: LobbySettingsUpdateRequest): Lobby {
    const lobby = getLobby(code);
    const player = findPlayer(lobby, update.playerId);

    if (update.settings && player.id !== lobby.hostId) {
      throw new AppError(403, "Only the host can update match rules");
    }

    if (update.settings) {
      lobby.settings = getUpdatedSettings(lobby.settings, update.settings);
    }

    if (update.teamNames) {
      lobby.teamNames = getUpdatedTeamNames(lobby, player.id, update.teamNames);
    }

    return lobby;
  }

  function markPlayerReady(code: string, playerId: string): Lobby {
    const lobby = getLobby(code);
    const player = findPlayer(lobby, playerId);

    player.ready = true;

    if (!lobby.assignments && isReadyToStart(lobby)) {
      lobby.assignments = assignSoccerTeams(lobby);
      initializePlayerStats(lobby);
      lobby.lastTouchPlayerId = null;
      lobbyLastCountedTouch.delete(code);
      lobby.match = createActiveMatch(lobby.settings, Date.now());
    }

    return lobby;
  }

  function recordBallTouch(code: string, playerId: string, touchedAt = Date.now()): Lobby {
    const lobby = getStoredLobby(code);

    assertMatchActive(lobby, touchedAt);

    const assignment = findAssignment(lobby, playerId);
    const lastCountedTouch = lobbyLastCountedTouch.get(code);

    lobby.lastTouchPlayerId = playerId;

    if (lastCountedTouch?.playerId === playerId && touchedAt - lastCountedTouch.touchedAt < 300) {
      return lobby;
    }

    const stats = getStats(lobby, playerId);

    if (assignment.role === "goalkeeper") {
      stats.blocks += 1;
      stats.points += 3;
    } else {
      stats.kicks += 1;
      stats.points += 1;
    }

    lobbyLastCountedTouch.set(code, { playerId, touchedAt });
    return lobby;
  }
}

function createActiveMatch(settings: GameSettings, now: number): MatchState {
  return {
    status: "active",
    startedAt: now,
    endsAt: now + settings.timerSeconds * 1000,
    finishedAt: null,
    winner: null,
    finishReason: null
  };
}

function syncLobbyLeaders(lobby: Lobby): void {
  if (!lobby.players.some((player) => player.id === lobby.hostId)) {
    lobby.hostId = lobby.players[0]?.id ?? null;
  }

  const players = lobby.players.filter((player) => player.joinChoice !== "spectator");
  const nextCaptains: Captains = {
    team1: players[0]?.id ?? null,
    team2: players[1]?.id ?? null
  };

  lobby.captains = nextCaptains;
}

function assertMatchActive(lobby: Lobby, now: number): void {
  finishMatchIfExpired(lobby, now);

  if (!lobby.assignments || lobby.match?.status !== "active") {
    throw new AppError(400, "Match is not active");
  }
}

function finishMatchIfExpired(lobby: Lobby, now: number): void {
  if (lobby.match?.status !== "active" || now < lobby.match.endsAt) {
    return;
  }

  finishMatch(lobby, "time-expired", getScoreLeader(lobby), now);
}

function finishMatch(lobby: Lobby, finishReason: MatchFinishReason, winner: TeamSide | null, finishedAt: number): void {
  const match = lobby.match;

  if (!match || match.status === "finished") {
    return;
  }

  lobby.match = {
    ...match,
    status: "finished",
    finishedAt,
    winner,
    finishReason
  };
}

function initializePlayerStats(lobby: Lobby): void {
  const playerStats: Record<string, PlayerStats> = {};

  for (const assignment of lobby.assignments ?? []) {
    playerStats[assignment.id] = createPlayerStats(assignment.id);
  }

  lobby.playerStats = playerStats;
}

function createPlayerStats(playerId: string): PlayerStats {
  return {
    playerId,
    kicks: 0,
    blocks: 0,
    goals: 0,
    ownGoals: 0,
    points: 0
  };
}

function recordGoalStats(lobby: Lobby, scoringTeam: TeamSide): void {
  const playerId = lobby.lastTouchPlayerId;

  if (!playerId) {
    return;
  }

  const assignment = lobby.assignments?.find((entry) => entry.id === playerId);
  lobby.lastTouchPlayerId = null;

  if (!assignment) {
    return;
  }

  const stats = getStats(lobby, playerId);

  if (getTeamSide(assignment.team) === scoringTeam) {
    stats.goals += 1;
    stats.points += 5;
    return;
  }

  stats.ownGoals += 1;
  stats.points -= 5;
}

function getStats(lobby: Lobby, playerId: string): PlayerStats {
  const existingStats = lobby.playerStats[playerId];

  if (existingStats) {
    return existingStats;
  }

  const nextStats = createPlayerStats(playerId);

  lobby.playerStats[playerId] = nextStats;
  return nextStats;
}

function findAssignment(lobby: Lobby, playerId: string): AssignedPlayer {
  const assignment = lobby.assignments?.find((entry) => entry.id === playerId);

  if (!assignment) {
    throw new AppError(404, "Player assignment not found");
  }

  return assignment;
}

function getTeamSide(playerTeam: PlayerTeam): TeamSide {
  return playerTeam === TEAM_CONFIG.team1.playerTeam ? "team1" : "team2";
}

function isTargetScoreReached(lobby: Lobby, scoringTeam: TeamSide): boolean {
  const targetScore = lobby.settings.mode === "suddenDeath" ? 1 : lobby.settings.winTarget;

  return lobby.score[scoringTeam] >= targetScore;
}

function getScoreLeader(lobby: Lobby): TeamSide | null {
  if (lobby.score.team1 === lobby.score.team2) {
    return null;
  }

  return lobby.score.team1 > lobby.score.team2 ? "team1" : "team2";
}

function isReadyToStart(lobby: Lobby): boolean {
  const activePlayers = getActivePlayers(lobby.players);
  const minimumReadyPlayers = Math.ceil(activePlayers.length * 0.5);

  return activePlayers.length >= TEAM_PLAYER_LIMIT.min * 2
    && activePlayers.filter((player) => player.ready).length >= minimumReadyPlayers;
}

function createPlayer(name: string, joinChoice: JoinChoice): Player {
  return {
    id: randomUUID(),
    name,
    ready: false,
    joinChoice
  };
}

function createLobbyCode(existingLobbies: ReadonlyMap<string, Lobby>): string {
  let code = "";

  do {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (existingLobbies.has(code));

  return code;
}

function findPlayer(lobby: Lobby, playerId: string): Player {
  const player = lobby.players.find((entry) => entry.id === playerId);

  if (!player) {
    throw new AppError(404, "Player not found");
  }

  return player;
}

function getUpdatedSettings(currentSettings: GameSettings, settings: Partial<GameSettings>): GameSettings {
  const mode = settings.mode ?? currentSettings.mode;

  if (mode !== "firstTo" && mode !== "suddenDeath") {
    throw new AppError(400, "Invalid win mode");
  }

  return {
    mode,
    winTarget: mode === "suddenDeath" ? 1 : normalizeInteger(settings.winTarget ?? currentSettings.winTarget, 1, 9, "winTarget"),
    timerSeconds: normalizeInteger(settings.timerSeconds ?? currentSettings.timerSeconds, 60, 600, "timerSeconds")
  };
}

function getUpdatedTeamNames(lobby: Lobby, playerId: string, teamNames: Partial<TeamNames>): TeamNames {
  const nextTeamNames = { ...lobby.teamNames };

  for (const team of TEAM_SIDES) {
    const nextName = teamNames[team];

    if (nextName === undefined) {
      continue;
    }

    assertCanRenameTeam(lobby, playerId, team);
    nextTeamNames[team] = normalizeTeamName(nextName, DEFAULT_TEAM_NAMES[team]);
  }

  return nextTeamNames;
}

function assertCanRenameTeam(lobby: Lobby, playerId: string, team: TeamSide): void {
  if (playerId !== lobby.captains[team]) {
    throw new AppError(403, "Only that team's captain can rename the team");
  }
}

function normalizeTeamName(value: string, fallback: string): string {
  const trimmedName = value.trim();
  return trimmedName ? trimmedName.slice(0, 24) : fallback;
}

function normalizeInteger(value: number, min: number, max: number, fieldName: string): number {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue)) {
    throw new AppError(400, `${fieldName} must be an integer`);
  }

  return Math.max(min, Math.min(max, numericValue));
}
