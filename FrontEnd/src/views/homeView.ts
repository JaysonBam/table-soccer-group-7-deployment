import { getStoredClientName, saveStoredClientName } from "../storage";
import type { HomeViewJoinData, JoinChoice, LobbyRequest } from "../types";

type HomeViewHandlers = {
  onCreate: (data: LobbyRequest) => void;
  onJoin: (data: HomeViewJoinData) => void;
};

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 '-]{0,22}[A-Za-z0-9]$/;

export function createHomeView(
  screen: HTMLElement,
  handlers: HomeViewHandlers
): { show: (message?: string) => void } {
  const nameForm = screen.querySelector<HTMLFormElement>("[data-name-form]")!;
  const nameInput = screen.querySelector<HTMLInputElement>("#person-name-input")!;
  const actions = screen.querySelector<HTMLElement>("[data-lobby-actions]")!;
  const greeting = screen.querySelector<HTMLParagraphElement>("[data-greeting]")!;
  const statusMessage = screen.querySelector<HTMLParagraphElement>("[data-home-status-message]")!;
  const joinButton = screen.querySelector<HTMLButtonElement>("[data-open-join-dialog]")!;
  const createButton = screen.querySelector<HTMLButtonElement>("[data-open-create-dialog]")!;
  const joinDialog = screen.querySelector<HTMLDialogElement>("[data-join-dialog]")!;
  const createDialog = screen.querySelector<HTMLDialogElement>("[data-create-dialog]")!;
  const joinForm = joinDialog.querySelector<HTMLFormElement>("[data-join-form]")!;
  const createForm = createDialog.querySelector<HTMLFormElement>("[data-create-form]")!;
  const lobbyCodeInput = joinDialog.querySelector<HTMLInputElement>("#join-lobby-code-input")!;
  let personName = "";

  nameInput.addEventListener("input", () => validateName(nameInput));
  nameForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!validateName(nameInput) || !nameForm.reportValidity()) {
      return;
    }

    personName = nameInput.value.trim();
    saveStoredClientName(personName);
    showActionStep("");
  });

  joinButton.addEventListener("click", () => {
    lobbyCodeInput.value = "";
    joinDialog.showModal();
    lobbyCodeInput.focus();
  });

  createButton.addEventListener("click", () => {
    createDialog.showModal();
  });

  for (const closeButton of screen.querySelectorAll<HTMLButtonElement>("[data-close-dialog]")) {
    closeButton.addEventListener("click", () => closeButton.closest("dialog")?.close());
  }

  lobbyCodeInput.addEventListener("input", () => {
    lobbyCodeInput.value = lobbyCodeInput.value.toUpperCase();
    validateLobbyCode(lobbyCodeInput);
  });

  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!validateLobbyCode(lobbyCodeInput) || !joinForm.reportValidity()) {
      return;
    }

    handlers.onJoin({
      personName,
      lobbyCode: lobbyCodeInput.value.trim().toUpperCase(),
      joinChoice: getSelectedJoinChoice(joinDialog, "joinChoice")
    });
    joinDialog.close();
  });

  createForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handlers.onCreate({
      personName,
      joinChoice: getSelectedJoinChoice(createDialog, "createChoice")
    });
    createDialog.close();
  });

  return {
    show: showNameStep
  };

  function showNameStep(message = ""): void {
    personName = "";
    greeting.hidden = true;
    actions.hidden = true;
    nameForm.hidden = false;
    nameInput.value = getStoredClientName();
    statusMessage.textContent = message;
    nameInput.focus();
  }

  function showActionStep(message = ""): void {
    greeting.textContent = `Hi ${personName}`;
    greeting.hidden = false;
    actions.hidden = false;
    nameForm.hidden = true;
    statusMessage.textContent = message;
  }
}

function validateName(input: HTMLInputElement): boolean {
  const value = input.value.trim();

  if (!value) {
    input.setCustomValidity("Enter your name.");
  } else if (value.length < 2) {
    input.setCustomValidity("Name must be at least 2 characters.");
  } else if (value.length > 24 || !NAME_PATTERN.test(value)) {
    input.setCustomValidity("Use 2-24 letters, numbers, spaces, apostrophes, or hyphens.");
  } else {
    input.setCustomValidity("");
  }

  return input.checkValidity();
}

function validateLobbyCode(input: HTMLInputElement): boolean {
  const value = input.value.trim().toUpperCase();

  if (!value) {
    input.setCustomValidity("Enter a game code.");
  } else if (!/^[A-Z0-9]{6}$/.test(value)) {
    input.setCustomValidity("Game code must be 6 letters or numbers.");
  } else {
    input.setCustomValidity("");
  }

  return input.checkValidity();
}

function getSelectedJoinChoice(dialog: HTMLDialogElement, fieldName: string): JoinChoice {
  return dialog.querySelector<HTMLInputElement>(`input[name="${fieldName}"]:checked`)!.value === "spectator"
    ? "spectator"
    : "player";
}
