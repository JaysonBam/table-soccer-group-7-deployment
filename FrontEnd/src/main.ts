import "./style.css";
import { createLobby, joinLobby, returnLobbyToWaitingRoom } from "./api";
import { connectLobbySocket, type LobbySocketConnection } from "./lobbySocket";
import { saveStoredClientName } from "./storage";
import { createHomeView } from "./views/homeView";
import { renderPitchView } from "./views/pitchView";
import { createWaitingRoomView } from "./views/waitingRoomView";
import type {
  BallMovementState,
  ClientPerson,
  FoosballTeam,
  HomeViewJoinData,
  JoinChoice,
  KickRequest,
  Lobby,
  LobbyRequest,
  PersonType,
  TeamSide
} from "./types";

const LOBBY_ROUTE = "lobby";
type ScreenName = "pitch" | "lobby" | "waiting";

let currentLobby: Lobby | null = null;
let currentPerson: ClientPerson | null = null;
let currentLobbySocket: LobbySocketConnection | null = null;
let currentPositions: Record<string, number> = {};
let currentBallState: BallMovementState | null = null;
let currentView: "preview" | "home" | "waiting" | "game" = "preview";
let cleanupCurrentPage: (() => void) | null = null;
let updateGamePosition: ((playerId: string, position: number) => void) | null = null;
let updateGameCheer: ((team: FoosballTeam) => void) | null = null;
let updateGameBallState: ((ballState: BallMovementState) => void) | null = null;
let updateGameLobby: ((lobby: Lobby) => void) | null = null;
let updateGameGoal: ((scoringTeam: TeamSide) => void) | null = null;
let socketReconnectHandle: number | undefined;

const app = document.querySelector<HTMLElement>("#app")!;
const pitchScreen = app.querySelector<HTMLElement>("#pitch-screen")!;
const lobbyScreen = app.querySelector<HTMLElement>("#lobby-screen")!;
const waitingScreen = app.querySelector<HTMLElement>("#waiting-screen")!;
const screens: Record<ScreenName, HTMLElement> = {
  pitch: pitchScreen,
  lobby: lobbyScreen,
  waiting: waitingScreen
};
const homeView = createHomeView(lobbyScreen, {
  onCreate: handleCreateLobby,
  onJoin: handleJoinLobby
});
const waitingRoomView = createWaitingRoomView(waitingScreen, {
  onStart: handleReady
});

window.addEventListener("hashchange", showCurrentRoute);
showCurrentRoute();

function showCurrentRoute(): void {
  if (getCurrentRoute() === LOBBY_ROUTE) {
    showHomeView();
    return;
  }

  showPitchPreview();
}

function showPitchPreview(): void {
  currentView = "preview";
  currentLobby = null;
  currentPerson = null;
  currentPositions = {};
  currentBallState = null;
  closeLobbySocket();
  cleanupRenderedPage();
  showScreen("pitch");

  cleanupCurrentPage = renderPitchView(pitchScreen, {
    onOpenLobby: openLobbyRoute
  });
}

function showHomeView(message = ""): void {
  currentView = "home";
  currentLobby = null;
  currentPerson = null;
  currentPositions = {};
  currentBallState = null;
  closeLobbySocket();
  cleanupRenderedPage();
  showScreen("lobby");

  homeView.show(message);
}

function showWaitingRoom(message = ""): void {
  if (!currentLobby || !currentPerson) {
    showHomeView("Lobby data was missing");
    return;
  }

  if (canGameStart(currentLobby)) {
    showGamePage();
    return;
  }

  currentView = "waiting";
  cleanupRenderedPage();
  showScreen("waiting");

  renderCurrentWaitingRoom(message);
}

function showGamePage(): void {
  if (!currentLobby || !currentPerson) {
    showHomeView("Lobby data was missing");
    return;
  }

  currentView = "game";
  cleanupRenderedPage();
  showScreen("pitch");

  cleanupCurrentPage = renderPitchView(pitchScreen, {
    lobby: currentLobby,
    currentPerson,
    initialPositions: currentPositions,
    initialBallState: currentBallState,
    onPositionChange: handleLocalPositionChange,
    onPositionUpdater: (updater) => {
      updateGamePosition = updater;
    },
    onCheer: handleLocalCheer,
    onKick: handleLocalKick,
    onCheerUpdater: (updater) => {
      updateGameCheer = updater;
    },
    onBallStateUpdater: (updater) => {
      updateGameBallState = updater;
    },
    onLobbyUpdater: (updater) => {
      updateGameLobby = updater;
    },
    onGoalUpdater: (updater) => {
      updateGameGoal = updater;
    },
    onLeaveLobby: () => showHomeView("You left the lobby."),
    onBackToWaitingRoom: handleBackToWaitingRoom
  });
}

async function handleCreateLobby(data: LobbyRequest): Promise<void> {
  try {
    const lobby = await createLobby({ personName: data.personName, joinChoice: data.joinChoice });

    enterLobby(lobby, data);
  } catch (error) {
    showHomeView(getErrorMessage(error));
  }
}

async function handleJoinLobby(data: HomeViewJoinData): Promise<void> {
  try {
    const lobby = await joinLobby(data.lobbyCode.toUpperCase(), {
      personName: data.personName,
      joinChoice: data.joinChoice
    });

    enterLobby(lobby, data);
  } catch (error) {
    showHomeView(getErrorMessage(error));
  }
}

function enterLobby(lobby: Lobby, data: LobbyRequest): void {
  currentLobby = lobby;
  currentPerson = createClientPerson(lobby, data.personName, data.joinChoice);
  currentPositions = {};
  currentBallState = null;
  connectCurrentLobbySocket();
  saveStoredClientName(currentPerson.name);
  showWaitingRoom();
}

function handleReady(): void {
  if (!currentLobby || !currentPerson) {
    showHomeView("Player data was missing");
    return;
  }

  currentPerson = {
    ...currentPerson,
    ready: true
  };
  currentLobby = {
    ...currentLobby,
    players: currentLobby.players.map((player) => player.id === currentPerson!.id ? { ...player, ready: true } : player)
  };
  saveStoredClientName(currentPerson.name);
  renderCurrentWaitingRoom();
  currentLobbySocket?.markReady();
}

function connectCurrentLobbySocket(): void {
  if (!currentLobby || !currentPerson) {
    return;
  }

  closeLobbySocket();

  currentLobbySocket = connectLobbySocket(currentLobby.code, currentPerson.id, {
    onLobby: handleSocketLobby,
    onPositions: handleSocketPositions,
    onPosition: handleSocketPosition,
    onCheer: handleSocketCheer,
    onBallState: handleSocketBallState,
    onGoal: handleSocketGoal,
    onError: handleSocketError
  });
  clearSocketReconnect();
}

function handleSocketLobby(lobby: Lobby): void {
  if (!currentLobby || lobby.code !== currentLobby.code) {
    return;
  }

  currentLobby = lobby;
  syncCurrentPersonReadyState();

  if (canGameStart(lobby)) {
    if (currentView !== "game") {
      showGamePage();
    } else {
      updateGameLobby?.(lobby);
    }

    return;
  }

  if (currentView === "game") {
    currentPositions = {};
    currentBallState = null;
    showWaitingRoom();
    return;
  }

  if (currentView === "waiting") {
    renderCurrentWaitingRoom();
  }
}

function handleSocketPositions(positions: Record<string, number>): void {
  currentPositions = positions;

  for (const [playerId, position] of Object.entries(positions)) {
    if (playerId === currentPerson?.id) {
      continue;
    }

    updateGamePosition?.(playerId, position);
  }
}

function handleSocketPosition(playerId: string, position: number): void {
  if (playerId === currentPerson?.id) {
    return;
  }

  currentPositions = {
    ...currentPositions,
    [playerId]: position
  };
  updateGamePosition?.(playerId, position);
}

function handleSocketCheer(team: FoosballTeam): void {
  updateGameCheer?.(team);
}

function handleSocketBallState(ballState: BallMovementState): void {
  if (currentBallState && ballState.sequence <= currentBallState.sequence) {
    return;
  }

  currentBallState = ballState;
  updateGameBallState?.(ballState);
}

function handleSocketGoal(scoringTeam: TeamSide): void {
  updateGameGoal?.(scoringTeam);
}

function handleLocalCheer(team: FoosballTeam): void {
  currentLobbySocket?.sendCheer(team);
}

function handleLocalKick(kick: KickRequest): void {
  currentLobbySocket?.sendKick(kick);
}

function handleLocalPositionChange(position: number): void {
  if (!currentPerson) {
    return;
  }

  currentPositions = {
    ...currentPositions,
    [currentPerson.id]: position
  };
  currentLobbySocket?.sendPosition(position);
}

async function handleBackToWaitingRoom(): Promise<void> {
  if (!currentLobby || !currentPerson) {
    showHomeView("Lobby data was missing");
    return;
  }

  try {
    const lobby = await returnLobbyToWaitingRoom(currentLobby.code, currentPerson.id);

    currentLobby = lobby;
    currentPerson = {
      ...currentPerson,
      ready: false
    };
    currentPositions = {};
    currentBallState = null;
    showWaitingRoom();
  } catch (error) {
    handleSocketError(getErrorMessage(error));
  }
}

function handleSocketError(message: string): void {
  if (currentView === "waiting") {
    renderCurrentWaitingRoom(message);
  }

  scheduleSocketReconnect();
}

function renderCurrentWaitingRoom(message = ""): void {
  if (!currentLobby || !currentPerson) {
    return;
  }

  waitingRoomView.show(currentLobby, currentPerson, message);
}

function scheduleSocketReconnect(): void {
  if (socketReconnectHandle !== undefined || !currentLobby || !currentPerson || currentView === "home" || currentView === "preview") {
    return;
  }

  socketReconnectHandle = window.setTimeout(() => {
    socketReconnectHandle = undefined;
    connectCurrentLobbySocket();
  }, 600);
}

function clearSocketReconnect(): void {
  if (socketReconnectHandle === undefined) {
    return;
  }

  window.clearTimeout(socketReconnectHandle);
  socketReconnectHandle = undefined;
}

function createClientPerson(lobby: Lobby, name: string, joinChoice: JoinChoice): ClientPerson {
  const player = [...lobby.players].reverse().find((currentPlayer) => currentPlayer.name === name)!;

  return {
    id: player.id,
    name,
    joinChoice,
    ready: player.ready,
    type: getPersonType(lobby, player.id, joinChoice)
  };
}

function getPersonType(lobby: Lobby, playerId: string, joinChoice: JoinChoice): PersonType {
  if (joinChoice === "spectator") {
    return "spectator";
  }

  const rosterPlayers = lobby.players.filter((player) => player.joinChoice !== "spectator");
  const playerIndex = rosterPlayers.findIndex((player) => player.id === playerId);

  return playerIndex % 2 === 0 ? "team1Player" : "team2Player";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function getCurrentRoute(): string {
  return window.location.hash.replace(/^#\/?/, "").toLowerCase();
}

function openLobbyRoute(): void {
  if (getCurrentRoute() === LOBBY_ROUTE) {
    showHomeView();
    return;
  }

  window.location.hash = LOBBY_ROUTE;
}

function canGameStart(lobby: Lobby): boolean {
  return Boolean(lobby.assignments?.length);
}

function showScreen(screenName: ScreenName): void {
  for (const [name, screen] of Object.entries(screens)) {
    screen.hidden = name !== screenName;
  }
}

function syncCurrentPersonReadyState(): void {
  if (!currentLobby || !currentPerson) {
    return;
  }

  const currentPersonId = currentPerson.id;
  const matchingPlayer = currentLobby.players.find((player) => player.id === currentPersonId)!;

  currentPerson = {
    ...currentPerson,
    ready: matchingPlayer.ready
  };
}

function closeLobbySocket(): void {
  clearSocketReconnect();
  currentLobbySocket?.close();
  currentLobbySocket = null;
}

function cleanupRenderedPage(): void {
  updateGamePosition = null;
  updateGameCheer = null;
  updateGameBallState = null;
  updateGameLobby = null;
  updateGameGoal = null;
  cleanupCurrentPage?.();
  cleanupCurrentPage = null;
}
