// Defines shared constants.

import type { BallFieldDimensions, Captains, GameSettings, Score, TeamNames } from "./types.ts";
import { TEAM_CONFIG } from "./types.ts";

export const SERVER_HOST = process.env.HOST ?? "0.0.0.0";
export const SERVER_PORT = Number(process.env.PORT ?? 3000);
export const TEAM_PLAYER_LIMIT = {
  min: 3,
  max: 10
} as const;
export const MAX_LOBBY_PLAYERS = 40;

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  mode: "firstTo",
  winTarget: 3,
  timerSeconds: 180
};

export const EMPTY_SCORE: Score = {
  team1: 0,
  team2: 0
};

export const EMPTY_CAPTAINS: Captains = {
  team1: null,
  team2: null
};

export const DEFAULT_TEAM_NAMES: TeamNames = {
  team1: TEAM_CONFIG.team1.defaultName,
  team2: TEAM_CONFIG.team2.defaultName
};

export const SOCCER_FIELD: BallFieldDimensions = {
  width: 1200,
  height: 800
};

export const SOCCER_BALL_RADIUS = 18;

export const SOCCER_DEFAULT_BALL_SPEED_RANGE = {
  min: 260,
  max: 340
} as const;

export const SOCCER_PLAYER_HORIZONTAL_RANGE = 0.38;

export const SOCCER_GOAL_OPENING = {
  height: 260
} as const;

export const SOCCER_KICK_TUNING = {
  minSwipeDistance: 24,
  maxSwipeDistance: 220,
  maxSwipeVelocity: 1800,
  minKickSpeed: 180,
  maxKickSpeed: 720,
  kickRadius: 95,
  cooldownMs: 125,
  maxLatencyCompensationMs: 250
} as const;

export const SOCCER_DEAD_BALL = {
  speedThreshold: 1,
  respawnDelayMs: 5000
} as const;

export const SOCCER_KICKOFF_PAUSE_MS = 3000;
