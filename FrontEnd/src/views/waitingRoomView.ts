import { updateLobbySettings } from "../api";
import type { ClientPerson, Lobby, PersonType, Player } from "../types";

type WaitingRoomHandlers = {
  onStart: () => void;
};

type DisplayPerson = {
  id: string;
  name: string;
  ready: boolean;
  type: PersonType;
  isCaptain: boolean;
};

const MIN_GAME_PLAYERS = 6;

export function createWaitingRoomView(
  screen: HTMLElement,
  handlers: WaitingRoomHandlers
): { show: (lobby: Lobby, person: ClientPerson, message?: string) => void } {
  const lobbyCode = screen.querySelector<HTMLParagraphElement>("[data-lobby-code]")!;
  const personType = screen.querySelector<HTMLParagraphElement>("[data-person-type]")!;
  const setupNotice = screen.querySelector<HTMLParagraphElement>("[data-setup-notice]")!;
  const captainFields = screen.querySelector<HTMLElement>("[data-captain-fields]")!;
  const teamNameFields = screen.querySelector<HTMLElement>("[data-team-name-fields]")!;
  const matchSettings = screen.querySelector<HTMLElement>("[data-match-settings]")!;
  const team1CaptainSelect = screen.querySelector<HTMLSelectElement>("[data-team1-captain]")!;
  const team2CaptainSelect = screen.querySelector<HTMLSelectElement>("[data-team2-captain]")!;
  const team1NameField = screen.querySelector<HTMLLabelElement>("[data-team1-name-field]")!;
  const team2NameField = screen.querySelector<HTMLLabelElement>("[data-team2-name-field]")!;
  const team1NameInput = screen.querySelector<HTMLInputElement>("[data-team1-name]")!;
  const team2NameInput = screen.querySelector<HTMLInputElement>("[data-team2-name]")!;
  const winModeSelect = screen.querySelector<HTMLSelectElement>("[data-win-mode]")!;
  const winTargetInput = screen.querySelector<HTMLInputElement>("[data-win-target]")!;
  const timerMinutesInput = screen.querySelector<HTMLInputElement>("[data-timer-minutes]")!;
  const timerSecondsInput = screen.querySelector<HTMLInputElement>("[data-timer-seconds]")!;
  const readyButton = screen.querySelector<HTMLButtonElement>("[data-ready-button]")!;
  const readyStatus = screen.querySelector<HTMLParagraphElement>("[data-ready-status]")!;
  const spectatorStatus = screen.querySelector<HTMLParagraphElement>("[data-spectator-status]")!;
  const statusMessage = screen.querySelector<HTMLParagraphElement>("[data-waiting-status-message]")!;
  let currentLobby: Lobby | null = null;
  let currentPerson: ClientPerson | null = null;

  team1NameInput.addEventListener("change", () => {
    void updateLobbySettings(currentLobby!.code, {
      playerId: currentPerson!.id,
      teamNames: { team1: team1NameInput.value.trim() || "Team 1" }
    });
  });

  team2NameInput.addEventListener("change", () => {
    void updateLobbySettings(currentLobby!.code, {
      playerId: currentPerson!.id,
      teamNames: { team2: team2NameInput.value.trim() || "Team 2" }
    });
  });

  winModeSelect.addEventListener("change", () => {
    const nextMode = winModeSelect.value === "suddenDeath" ? "suddenDeath" : "firstTo";
    const nextTarget = nextMode === "suddenDeath" ? 1 : 3;

    void updateLobbySettings(currentLobby!.code, {
      playerId: currentPerson!.id,
      settings: {
        mode: nextMode,
        winTarget: nextTarget
      }
    });
  });

  winTargetInput.addEventListener("change", () => {
    const rawTarget = Number(winTargetInput.value) || 1;
    const normalizedTarget = currentLobby!.settings.mode === "suddenDeath"
      ? 1
      : normalizeWinTarget(rawTarget);

    winTargetInput.value = String(normalizedTarget);
    void updateLobbySettings(currentLobby!.code, {
      playerId: currentPerson!.id,
      settings: {
        winTarget: normalizedTarget
      }
    });
  });

  timerMinutesInput.addEventListener("change", () => {
    const minutes = clampNumber(Number(timerMinutesInput.value) || 1, 1, 10);

    timerMinutesInput.value = String(minutes);
    void updateLobbySettings(currentLobby!.code, {
      playerId: currentPerson!.id,
      settings: {
        timerSeconds: minutes * 60
      }
    });
  });

  timerSecondsInput.addEventListener("change", () => {
    const minutes = Math.floor(currentLobby!.settings.timerSeconds / 60);
    const seconds = clampNumber(Number(timerSecondsInput.value) || 0, 0, 59);

    timerSecondsInput.value = String(seconds);
    void updateLobbySettings(currentLobby!.code, {
      playerId: currentPerson!.id,
      settings: {
        timerSeconds: minutes * 60 + seconds
      }
    });
  });

  readyButton.addEventListener("click", handlers.onStart);

  return {
    show
  };

  function show(lobby: Lobby, person: ClientPerson, message = ""): void {
    const isHost = person.id === lobby.hostId;
    const isTeam1Captain = person.id === lobby.captains.team1;
    const isTeam2Captain = person.id === lobby.captains.team2;
    const canEditTeamNames = isTeam1Captain || isTeam2Captain;
    const startStatus = getStartStatus(lobby);
    const remainingReadyPlayers = getRemainingReadyPlayers(lobby);
    const isReady = isPersonReady(lobby, person);

    currentLobby = lobby;
    currentPerson = person;
    lobbyCode.textContent = `Join game ${lobby.code}`;
    personType.textContent = `You are: ${getPersonTypeLabel(person.type)}`;
    statusMessage.textContent = message;

    populateCaptainSelect(team1CaptainSelect, lobby.players, lobby.captains.team1);
    populateCaptainSelect(team2CaptainSelect, lobby.players, lobby.captains.team2);
    team1NameInput.value = lobby.teamNames.team1;
    team2NameInput.value = lobby.teamNames.team2;
    winModeSelect.value = lobby.settings.mode;
    winTargetInput.value = String(lobby.settings.winTarget);
    winTargetInput.max = lobby.settings.mode === "suddenDeath" ? "1" : "9";
    timerMinutesInput.value = String(Math.max(1, Math.round(lobby.settings.timerSeconds / 60)));
    timerSecondsInput.value = String(lobby.settings.timerSeconds % 60);

    captainFields.hidden = true;
    teamNameFields.hidden = !canEditTeamNames;
    matchSettings.hidden = !isHost;
    team1NameField.hidden = !isTeam1Captain;
    team2NameField.hidden = !isTeam2Captain;
    setupNotice.hidden = canEditTeamNames;
    setupNotice.textContent = "Only captains can change team names.";

    populatePeopleList(screen, "team1Player", lobby, person);
    populatePeopleList(screen, "team2Player", lobby, person);
    populatePeopleList(screen, "spectator", lobby, person);

    if (person.type === "spectator") {
      readyButton.hidden = true;
      readyStatus.hidden = true;
      spectatorStatus.hidden = false;
      spectatorStatus.textContent = startStatus ?? "Waiting for players to start.";
      return;
    }

    readyButton.hidden = false;
    readyStatus.hidden = false;
    spectatorStatus.hidden = true;
    readyButton.disabled = isReady || Boolean(startStatus);
    readyStatus.textContent = startStatus ?? getReadyStatus(remainingReadyPlayers);
  }
}

function populateCaptainSelect(
  select: HTMLSelectElement,
  players: Player[],
  currentValue: string | null
): void {
  const emptyOption = document.createElement("option");
  const options = [emptyOption];

  emptyOption.value = "";
  emptyOption.textContent = "No captain";

  for (const player of players) {
    const option = document.createElement("option");

    option.value = player.id;
    option.textContent = player.name;
    option.selected = player.id === currentValue;
    options.push(option);
  }

  select.replaceChildren(...options);
}

function populatePeopleList(
  screen: HTMLElement,
  type: PersonType,
  lobby: Lobby,
  clientPerson: ClientPerson
): void {
  const list = screen.querySelector<HTMLUListElement>(`[data-people-list="${type}"]`)!;
  const people = createDisplayPeople(lobby, clientPerson).filter((person) => person.type === type);

  list.replaceChildren();

  if (people.length === 0) {
    const emptyItem = document.createElement("li");

    emptyItem.className = "empty";
    emptyItem.textContent = "Empty";
    list.append(emptyItem);
    return;
  }

  for (const person of people) {
    list.append(createPersonListItem(person));
  }
}

function createPersonListItem(person: DisplayPerson): HTMLLIElement {
  const item = document.createElement("li");
  const name = document.createElement("span");
  const captainBadge = document.createElement("span");
  const readyPill = document.createElement("span");

  item.className = "person-item";
  name.textContent = person.name;
  captainBadge.className = "captain-pill";
  captainBadge.textContent = "Captain";
  captainBadge.hidden = !person.isCaptain;
  readyPill.className = "ready-pill";
  readyPill.hidden = true;
  item.append(name, captainBadge, readyPill);

  if (person.type !== "spectator") {
    readyPill.hidden = false;
    readyPill.classList.add(person.ready ? "is-ready" : "not-ready");
    readyPill.textContent = person.ready ? "Ready" : "Not ready";
  }

  return item;
}

function createDisplayPeople(lobby: Lobby, clientPerson: ClientPerson): DisplayPerson[] {
  let rosterIndex = 0;

  return lobby.players.map((player) => {
    const isCurrentClient = player.id === clientPerson.id;
    const isSpectator = isCurrentClient
      ? clientPerson.type === "spectator"
      : player.joinChoice === "spectator";

    if (isSpectator) {
      return {
        id: player.id,
        name: player.name,
        ready: player.ready,
        type: "spectator",
        isCaptain: player.id === lobby.captains.team1 || player.id === lobby.captains.team2
      };
    }

    const type: PersonType = isCurrentClient
      ? clientPerson.type
      : rosterIndex % 2 === 0 ? "team1Player" : "team2Player";

    rosterIndex += 1;

    return {
      id: player.id,
      name: player.name,
      ready: player.ready,
      type,
      isCaptain: player.id === lobby.captains.team1 || player.id === lobby.captains.team2
    };
  });
}

function getStartStatus(lobby: Lobby): string | null {
  const activePlayers = getActivePlayers(lobby.players);
  const maxGamePlayers = 20;

  if (activePlayers.length > maxGamePlayers) {
    return `Only ${maxGamePlayers} active players can play at once. Extra joined users should spectate.`;
  }

  const missingPlayers = Math.max(MIN_GAME_PLAYERS - activePlayers.length, 0);

  if (missingPlayers === 0) {
    return null;
  }

  return `Need ${missingPlayers} more ${missingPlayers === 1 ? "player" : "players"} to start (minimum ${MIN_GAME_PLAYERS}).`;
}

function getRemainingReadyPlayers(lobby: Lobby): number {
  const activePlayers = getActivePlayers(lobby.players);
  const requiredReadyPlayers = Math.ceil(activePlayers.length * 0.5);
  const readyPlayers = activePlayers.filter((player) => player.ready).length;

  return Math.max(requiredReadyPlayers - readyPlayers, 0);
}

function getReadyStatus(remainingReadyPlayers: number): string {
  if (remainingReadyPlayers === 0) {
    return "Enough players are ready. Starting game...";
  }

  return `Waiting for ${remainingReadyPlayers} more ${remainingReadyPlayers === 1 ? "player" : "players"} to be ready (50% of players need to be ready).`;
}

function isPersonReady(lobby: Lobby, person: ClientPerson): boolean {
  return lobby.players.find((player) => player.id === person.id)?.ready ?? person.ready;
}

function getPersonTypeLabel(type: PersonType): string {
  if (type === "team1Player") {
    return "Team 1 player";
  }

  if (type === "team2Player") {
    return "Team 2 player";
  }

  return "Spectator";
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeWinTarget(value: number): number {
  const clampedValue = clampNumber(value, 1, 9);

  return clampedValue % 2 === 0 ? clampedValue - 1 : clampedValue;
}

function getActivePlayers(players: Player[]): Player[] {
  return players.filter((player) => player.joinChoice === "player");
}
