export type JoinChoice = "player" | "spectator";
export type PersonType = "team1Player" | "team2Player" | "spectator";
export type FoosballRole = "goalkeeper" | "defender" | "midfielder" | "attacker";
export type FoosballTeam = Extract<PersonType, "team1Player" | "team2Player">;
export type MatchStatus = "active" | "finished";
export type MatchFinishReason = "target-score" | "time-expired";

export type Player = {
  id: string;
  name: string;
  ready: boolean;
  joinChoice: JoinChoice;
};

export type Score = {
  team1: number;
  team2: number;
};

export type TeamNames = {
  team1: string;
  team2: string;
};

export type Captains = {
  team1: string | null;
  team2: string | null;
};

export type GameSettings = {
  mode: "firstTo" | "suddenDeath";
  winTarget: number;
  timerSeconds: number;
};

export type MatchState = {
  status: MatchStatus;
  startedAt: number;
  endsAt: number;
  finishedAt: number | null;
  winner: "team1" | "team2" | null;
  finishReason: MatchFinishReason | null;
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
  assignments?: AssignedFoosballPlayer[];
};

export type AssignedFoosballPlayer = {
  id: string;
  name: string;
  team: FoosballTeam;
  role: FoosballRole;
  verticalLane: number;
  horizontalSlot: number;
};

export type Vector2D = {
  x: number;
  y: number;
};

export type BallMovementReason = "spawn" | "wall-bounce" | "round-reset" | "kick" | "resync";

export type BallMovementState = {
  sequence: number;
  reason: BallMovementReason;
  startPosition: Vector2D;
  velocity: Vector2D;
  friction: number;
  serverTimestamp: number;
  radius: number;
  field: {
    width: number;
    height: number;
  };
};

export type KickRequest = {
  direction: Vector2D;
  distance: number;
  velocity: number;
  clientTimestamp?: number;
  playerPosition?: number;
};

export type ClientPerson = {
  id: string;
  name: string;
  joinChoice: JoinChoice;
  type: PersonType;
  ready: boolean;
};

export type LobbyRequest = {
  personName: string;
  joinChoice: JoinChoice;
};

export type ScoreUpdateRequest = {
  team?: "team1" | "team2";
  action?: "reset";
};

export type LobbySettingsUpdateRequest = {
  playerId: string;
  captains?: Partial<Captains>;
  teamNames?: Partial<TeamNames>;
  settings?: Partial<GameSettings>;
};

export type HomeViewJoinData = LobbyRequest & {
  lobbyCode: string;
};
