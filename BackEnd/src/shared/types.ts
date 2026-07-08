// Defines shared types.

export const TEAM_CONFIG = {
  team1: {
    playerTeam: "team1Player",
    defaultName: "Team 1"
  },
  team2: {
    playerTeam: "team2Player",
    defaultName: "Team 2"
  }
} as const;

export const TEAM_SIDES = ["team1", "team2"] as const;

export type TeamSide = keyof typeof TEAM_CONFIG;
export type PlayerTeam = typeof TEAM_CONFIG[TeamSide]["playerTeam"];
export type WinMode = "firstTo" | "suddenDeath";
export type JoinChoice = "player" | "spectator";
export type SoccerRole = "goalkeeper" | "defender" | "midfielder" | "attacker";
export type MatchStatus = "active" | "finished";
export type MatchFinishReason = "target-score" | "time-expired";

export type Player = {
  id: string;
  name: string;
  ready: boolean;
  joinChoice: JoinChoice;
};

export type Score = Record<TeamSide, number>;
export type TeamNames = Record<TeamSide, string>;
export type Captains = Record<TeamSide, string | null>;

export type GameSettings = {
  mode: WinMode;
  winTarget: number;
  timerSeconds: number;
};

export type MatchState = {
  status: MatchStatus;
  startedAt: number;
  endsAt: number;
  finishedAt: number | null;
  winner: TeamSide | null;
  finishReason: MatchFinishReason | null;
};

export type AssignedPlayer = {
  id: string;
  name: string;
  team: PlayerTeam;
  role: SoccerRole;
  verticalLane: number;
  horizontalSlot: number;
};

export type Lobby = {
  code: string;
  players: Player[];
  score: Score;
  hostId: string;
  captains: Captains;
  teamNames: TeamNames;
  settings: GameSettings;
  match?: MatchState;
  assignments?: AssignedPlayer[];
};

export type ScoreUpdateRequest = {
  team?: TeamSide;
  action?: "reset";
};

export type LobbySettingsUpdateRequest = {
  playerId: string;
  captains?: Partial<Captains>;
  teamNames?: Partial<TeamNames>;
  settings?: Partial<GameSettings>;
};

export type ClientSocketMessage =
  | { type: "ready" }
  | { type: "position"; position: number }
  | { type: "cheer"; team: PlayerTeam }
  | { type: "kick"; direction: Vector2D; distance: number; velocity: number; clientTimestamp?: number; playerPosition?: number };

export type ServerSocketMessage =
  | { type: "lobby"; lobby: Lobby }
  | { type: "positions"; positions: Record<string, number> }
  | { type: "position"; playerId: string; position: number }
  | { type: "cheer"; team: PlayerTeam }
  | { type: "ballState"; ball: BallMovementState }
  | { type: "goal"; scoringTeam: TeamSide }
  | { type: "error"; message: string };

export type Vector2D = {
  x: number;
  y: number;
};

export type BallMovementReason = "spawn" | "wall-bounce" | "round-reset" | "kick" | "resync" | "kickoff-pause";

export type BallFieldDimensions = {
  width: number;
  height: number;
};

export type BallMovementState = {
  sequence: number;
  reason: BallMovementReason;
  startPosition: Vector2D;
  velocity: Vector2D;
  friction: number;
  serverTimestamp: number;
  radius: number;
  field: BallFieldDimensions;
};

export function getActivePlayers(players: Player[]): Player[] {
  return players.filter((player) => player.joinChoice === "player");
}
