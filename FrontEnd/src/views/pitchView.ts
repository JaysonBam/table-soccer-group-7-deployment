import { canUseGyroControl, initGyroControl, initKeyboardFallback, needsGyroPermission, stopGyroControl } from "../game/gyro-control";
import { playCheer, playGoalHorn, playWhistle } from "../game/sound-effects";
import type {
  AssignedFoosballPlayer,
  BallMovementState,
  ClientPerson,
  FoosballRole,
  FoosballTeam,
  KickRequest,
  Lobby,
  MatchState,
  PlayerStats,
  TeamSide,
  Vector2D
} from "../types";

type PitchViewHandlers = {
  lobby?: Lobby;
  currentPerson?: ClientPerson;
  initialPositions?: Record<string, number>;
  initialBallState?: BallMovementState | null;
  onPositionChange?: (position: number) => void;
  onPositionUpdater?: (updater: ((playerId: string, position: number) => void) | null) => void;
  onCheer?: (team: FoosballTeam) => void;
  onKick?: (kick: KickRequest) => void;
  onCheerUpdater?: (updater: ((team: FoosballTeam) => void) | null) => void;
  onBallStateUpdater?: (updater: ((ballState: BallMovementState) => void) | null) => void;
  onLobbyUpdater?: (updater: ((lobby: Lobby) => void) | null) => void;
  onGoalUpdater?: (updater: ((scoringTeam: TeamSide) => void) | null) => void;
  onOpenLobby?: () => void;
  onLeaveLobby?: () => void;
};

type PlayerMarkerState = {
  playerId?: string;
  element: HTMLDivElement;
  isControlled: boolean;
};

type SwipePointerState = {
  pointerId: number;
  startX: number;
  startY: number;
  startAt: number;
  previousX: number;
  previousY: number;
  previousAt: number;
  latestX: number;
  latestY: number;
  latestAt: number;
};

type DragPointerState = {
  pointerId: number;
  latestPosition: number;
  animationFrame: number;
};

const PLAYER_X_RANGE_PERCENT = 38;
const MAX_AUTONOMOUS_X = 1;
const CHEER_BURST_DURATION_MS = 900;
const GOAL_ANNOUNCEMENT_DURATION_MS = 3000;
const KICKOFF_COUNTDOWN_MS = 3000;
const MIN_KICK_SWIPE_DISTANCE = 24;
const POSITION_SEND_INTERVAL_MS = 500;
const POSITION_SEND_EPSILON = 0.015;
const GYRO_RENDER_EASE = 0.25;

export function renderPitchView(screen: HTMLElement, handlers: PitchViewHandlers = {}): () => void {
  const listenerController = new AbortController();
  const listenerOptions = { signal: listenerController.signal };
  const lobbyButton = screen.querySelector<HTMLButtonElement>("[data-open-lobby-button]")!;
  const motionButton = screen.querySelector<HTMLButtonElement>("[data-motion-button]")!;
  const controlStatus = screen.querySelector<HTMLParagraphElement>("[data-control-status]")!;
  const team1Name = screen.querySelector<HTMLSpanElement>("[data-team1-name]")!;
  const team2Name = screen.querySelector<HTMLSpanElement>("[data-team2-name]")!;
  const team1Score = screen.querySelector<HTMLElement>("[data-team1-score]")!;
  const team2Score = screen.querySelector<HTMLElement>("[data-team2-score]")!;
  const pitchShell = screen.querySelector<HTMLElement>(".pitch-shell")!;
  const pitchFrame = screen.querySelector<HTMLDivElement>(".pitch-frame")!;
  const boundary = screen.querySelector<HTMLDivElement>(".boundary")!;
  const rodLayer = screen.querySelector<HTMLDivElement>("[data-rod-layer]")!;
  const playerLayer = screen.querySelector<HTMLDivElement>("[data-player-layer]")!;
  const ball = screen.querySelector<HTMLDivElement>("[data-ball]")!;
  const cheerLayer = screen.querySelector<HTMLDivElement>("[data-cheer-layer]")!;
  const timerLabel = screen.querySelector<HTMLSpanElement>("[data-timer-label]")!;
  const winLabel = screen.querySelector<HTMLSpanElement>("[data-win-label]")!;
  const statusLabel = screen.querySelector<HTMLSpanElement>("[data-status-label]")!;
  const goalFlash = screen.querySelector<HTMLElement>("[data-goal-flash]")!;
  const kickoffCountdown = screen.querySelector<HTMLElement>("[data-kickoff-countdown]")!;
  const pitchFooter = screen.querySelector<HTMLElement>(".pitch-footer")!;
  const cheerRow = screen.querySelector<HTMLElement>("[data-cheer-row]")!;
  const cheerCounts = screen.querySelector<HTMLParagraphElement>("[data-cheer-counts]")!;
  const cheerTeam1Button = screen.querySelector<HTMLButtonElement>("[data-cheer-team1-button]")!;
  const cheerTeam2Button = screen.querySelector<HTMLButtonElement>("[data-cheer-team2-button]")!;
  let controlledMarker: PlayerMarkerState | null = null;
  let latestBallState: BallMovementState | null = null;
  let visualBallPosition: Vector2D | null = null;
  let activeSwipe: SwipePointerState | null = null;
  let activeDrag: DragPointerState | null = null;
  let motionPermissionPrompt: HTMLDivElement | null = null;
  let ballAnimationFrame = 0;
  let serverClockOffsetMs = 0;
  let currentControlledPosition = Number.NaN;
  let lastSentPosition = Number.NaN;
  let lastSentAt = -POSITION_SEND_INTERVAL_MS;
  let gyroTargetPosition = Number.NaN;
  let gyroRenderFrame = 0;
  let team1ScoreValue = handlers.lobby?.score.team1 ?? 0;
  let team2ScoreValue = handlers.lobby?.score.team2 ?? 0;
  let lobbyData: Lobby | null = handlers.lobby ?? null;
  let winTarget = handlers.lobby?.settings.winTarget ?? 3;
  let mode: "firstTo" | "suddenDeath" = handlers.lobby?.settings.mode ?? "firstTo";
  let matchState: MatchState | null = handlers.lobby?.match ?? null;
  let timerHandle: number | undefined;
  let matchFinished = matchState?.status === "finished";
  let team1CheerCount = 0;
  let team2CheerCount = 0;
  let goalFlashTimeout: number | undefined;
  let kickoffCountdownInterval: number | undefined;
  let gameOverModal: HTMLDivElement | null = null;
  const isSpectator = handlers.currentPerson?.type === "spectator";
  const isTeam2View = handlers.currentPerson?.type === "team2Player";

  rodLayer.replaceChildren();
  playerLayer.replaceChildren();
  cheerLayer.replaceChildren();
  pitchFrame.querySelector("[data-motion-permission-prompt]")?.remove();
  ball.hidden = true;
  controlStatus.hidden = true;
  controlStatus.textContent = "";
  goalFlash.classList.remove("is-visible");
  kickoffCountdown.classList.remove("is-visible");
  pitchFrame.classList.toggle("is-team2-view", isTeam2View);
  lobbyButton.hidden = !handlers.onOpenLobby || handlers.lobby?.match?.status === "active";

  if (!lobbyButton.hidden) {
    lobbyButton.addEventListener("click", () => handlers.onOpenLobby?.(), listenerOptions);
  }
  pitchFooter.hidden = !handlers.lobby;

  motionButton.addEventListener("click", () => {
    void startGyro();
  }, listenerOptions);

  cheerRow.hidden = !isSpectator;
  cheerCounts.hidden = !handlers.lobby;
  cheerTeam1Button.addEventListener("click", () => sendCheer("team1Player"), listenerOptions);
  cheerTeam2Button.addEventListener("click", () => sendCheer("team2Player"), listenerOptions);

  renderCheerCounts();
  boundary.addEventListener("pointerdown", handleKickPointerDown, listenerOptions);
  boundary.addEventListener("pointermove", handleKickPointerMove, listenerOptions);
  boundary.addEventListener("pointerup", handleKickPointerEnd, listenerOptions);
  boundary.addEventListener("pointercancel", handleKickPointerCancel, listenerOptions);
  boundary.addEventListener("touchmove", handleDragTouchMove, { signal: listenerController.signal, passive: false });

  const markers = handlers.lobby
    ? buildGameplayPlayers(handlers.lobby, handlers.currentPerson, rodLayer, playerLayer, handlers.initialPositions ?? {})
    : [buildPreviewPlayer(playerLayer)];
  const markerByPlayerId = new Map(markers.flatMap((marker) => marker.playerId ? [[marker.playerId, marker.element] as const] : []));

  controlledMarker = markers.find((marker) => marker.isControlled) ?? null;
  motionButton.hidden = !controlledMarker || (!canUseGyroControl() && window.isSecureContext);
  motionButton.textContent = "Motion";

  if (controlledMarker && handlers.lobby && needsGyroPermission()) {
    showMotionPermissionPrompt();
  }

  handlers.onPositionUpdater?.((playerId, position) => {
    const marker = markerByPlayerId.get(playerId);

    if (marker) {
      setMarkerHorizontalPosition(marker, position);
    }
  });
  handlers.onCheerUpdater?.((team) => playCheerBurst(team));
  handlers.onBallStateUpdater?.(updateBallState);
  handlers.onLobbyUpdater?.(applyLobbySnapshot);
  handlers.onGoalUpdater?.((scoringTeam) => showGoalFlash(scoringTeam));

  if (handlers.initialBallState) {
    updateBallState(handlers.initialBallState);
  }

  updateScoreboard();
  updateMatchMeta();
  updateGameOverModal();
  startTimer();

  const stopKeyboardFallback = controlledMarker ? initKeyboardFallback(updateScreenAxisPlayerPosition) : () => undefined;

  if (controlledMarker && !needsGyroPermission()) {
    void startGyro();
  }

  return () => {
    listenerController.abort();
    stopTimer();
    gameOverModal?.remove();
    gameOverModal = null;
    handlers.onPositionUpdater?.(null);
    handlers.onCheerUpdater?.(null);
    handlers.onBallStateUpdater?.(null);
    handlers.onLobbyUpdater?.(null);
    handlers.onGoalUpdater?.(null);
    window.clearTimeout(goalFlashTimeout);
    window.clearInterval(kickoffCountdownInterval);
    cancelAnimationFrame(ballAnimationFrame);
    stopDragPositionStream();
    stopGyroRenderLoop();
    dismissMotionPermissionPrompt();
    stopKeyboardFallback();
    stopGyroControl();
  };

  function updateScoreboard(): void {
    team1Score.textContent = String(team1ScoreValue);
    team2Score.textContent = String(team2ScoreValue);
  }

  function applyLobbySnapshot(lobby: Lobby): void {
    lobbyData = lobby;
    team1ScoreValue = lobby.score.team1;
    team2ScoreValue = lobby.score.team2;
    winTarget = lobby.settings.winTarget;
    mode = lobby.settings.mode;
    matchState = lobby.match ?? null;
    matchFinished = matchState?.status === "finished";
    updateScoreboard();
    updateMatchMeta();
    updateGameOverModal();

    if (matchState?.status === "active") {
      startTimer();
      return;
    }

    stopTimer();
  }

  function updateGameOverModal(): void {
    if (!lobbyData || matchState?.status !== "finished") {
      gameOverModal?.remove();
      gameOverModal = null;
      return;
    }

    if (!gameOverModal) {
      gameOverModal = createGameOverModal();
      pitchShell.append(gameOverModal);
    }

    renderGameOverModal(gameOverModal, lobbyData);
  }

  function createGameOverModal(): HTMLDivElement {
    const overlay = document.createElement("div");

    overlay.className = "game-over-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Game Over");
    return overlay;
  }

  function renderGameOverModal(overlay: HTMLDivElement, lobby: Lobby): void {
    const mvp = getMvpPlayer(lobby);
    const rankedRows = getRankedStatRows(lobby);
    const winnerText = getFinalScoreText(lobby);
    const card = document.createElement("section");
    const title = document.createElement("h2");
    const finalScore = document.createElement("p");
    const mvpSummary = document.createElement("p");
    const legend = document.createElement("p");
    const pointsList = document.createElement("ol");
    const leaders = document.createElement("section");
    const actions = document.createElement("p");
    const homeButton = document.createElement("button");

    card.className = "game-over-card";
    title.textContent = "Game Over";
    finalScore.className = "game-over-score";
    finalScore.textContent = winnerText;
    mvpSummary.className = "game-over-mvp";
    mvpSummary.textContent = mvp ? `MVP: ${mvp.assignment.name}` : "MVP: No touches recorded";
    legend.className = "game-over-legend";
    legend.textContent = "Kick +1 | Block +3 | Goal +5 | Own Goal -5";

    pointsList.className = "game-over-points-list";
    rankedRows.forEach((row, index) => {
      const item = document.createElement("li");
      const rank = document.createElement("span");
      const player = document.createElement("span");
      const points = document.createElement("strong");

      item.className = row.assignment.id === mvp?.assignment.id ? "is-mvp" : "";
      rank.className = "game-over-rank";
      rank.textContent = `#${index + 1}`;
      player.textContent = `${row.assignment.name} (${getTeamName(lobby, row.assignment.team)})`;
      points.textContent = `${row.stats.points} pts`;
      item.append(rank, player, points);
      pointsList.append(item);
    });

    leaders.className = "game-over-leaders";
    leaders.append(
      createLeaderItem("Most kicks", getStatLeaders(rankedRows, "kicks")),
      createLeaderItem("Most blocks", getStatLeaders(rankedRows, "blocks")),
      createLeaderItem("Most goals", getStatLeaders(rankedRows, "goals")),
      createLeaderItem("Own goals", getStatLeaders(rankedRows, "ownGoals"))
    );
    actions.className = "game-over-actions";
    homeButton.className = "button primary";
    homeButton.type = "button";
    homeButton.textContent = "Home";
    homeButton.addEventListener("click", () => handlers.onLeaveLobby?.(), { signal: listenerController.signal });
    actions.append(homeButton);
    card.append(title, finalScore, mvpSummary, pointsList, leaders, legend, actions);
    overlay.replaceChildren(card);
  }

  function stopTimer(): void {
    if (timerHandle !== undefined) {
      window.clearInterval(timerHandle);
      timerHandle = undefined;
    }
  }

  function updateMatchMeta(): void {
    const winText = mode === "suddenDeath" ? "Sudden death" : `First to ${winTarget}`;
    const remainingSeconds = getRemainingSeconds(matchState, lobbyData?.settings.timerSeconds ?? 180);
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    const timeText = `${minutes}:${seconds.toString().padStart(2, "0")}`;

    timerLabel.textContent = `${timeText}`;
    winLabel.textContent = winText;
    team1Name.textContent = lobbyData?.teamNames.team1 ?? "Team 1";
    team2Name.textContent = lobbyData?.teamNames.team2 ?? "Team 2";

    if (matchFinished) {
      const winnerName = getWinnerName();

      statusLabel.textContent = winnerName === "Draw" ? "Draw" : `${winnerName} wins`;
      return;
    }

    if (matchState?.status === "active" && remainingSeconds <= 0) {
      statusLabel.textContent = "Time up";
      return;
    }

    statusLabel.textContent = matchState?.status === "active" ? "" : "Waiting";
  }

  function startTimer(): void {
    if (timerHandle !== undefined || matchState?.status !== "active") {
      return;
    }

    updateMatchMeta();
    timerHandle = window.setInterval(updateMatchMeta, 1000);
  }

  function getRemainingSeconds(match: MatchState | null, fallbackSeconds: number): number {
    if (!match) {
      return fallbackSeconds;
    }

    if (match.status === "finished" && match.finishReason === "time-expired") {
      return 0;
    }

    const referenceTime = match.status === "finished"
      ? match.finishedAt ?? Date.now()
      : Date.now();

    return Math.max(0, Math.ceil((match.endsAt - referenceTime) / 1000));
  }

  function getWinnerName(): string {
    if (matchState?.winner === "team1") {
      return lobbyData?.teamNames.team1 ?? "Team 1";
    }

    if (matchState?.winner === "team2") {
      return lobbyData?.teamNames.team2 ?? "Team 2";
    }

    return "Draw";
  }

  function showGoalFlash(scoringTeam: TeamSide): void {
    playGoalHorn();

    const teamName = scoringTeam === "team1"
      ? lobbyData?.teamNames.team1 ?? "Team 1"
      : lobbyData?.teamNames.team2 ?? "Team 2";

    window.clearTimeout(goalFlashTimeout);
    goalFlash.textContent = `${teamName} scored a goal!`;
    goalFlash.classList.add("is-visible");
    goalFlashTimeout = window.setTimeout(() => goalFlash.classList.remove("is-visible"), GOAL_ANNOUNCEMENT_DURATION_MS);
  }

  function updatePlayerPosition(tilt: number, forceSend = false): void {
    if (!controlledMarker) {
      return;
    }

    const clampedTilt = Math.max(-1, Math.min(1, tilt));

    currentControlledPosition = clampedTilt;
    setMarkerHorizontalPosition(controlledMarker.element, clampedTilt);
    sendControlledPosition(clampedTilt, forceSend);
  }

  function updateScreenAxisPlayerPosition(tilt: number, forceSend = false): void {
    updatePlayerPosition(toScreenAxisPosition(tilt), forceSend);
  }

  function toScreenAxisPosition(tilt: number): number {
    return isTeam2View ? -tilt : tilt;
  }

  function updateGyroPosition(tilt: number): void {
    gyroTargetPosition = toScreenAxisPosition(tilt);
    ensureGyroRenderLoop();
  }

  // iOS dispatches deviceorientation far less often/regularly than Android, so driving the
  // marker straight off each event (as keyboard/drag do) looks stepped. Render every animation
  // frame instead and ease toward the latest sensor reading, independent of event rate.
  function ensureGyroRenderLoop(): void {
    if (gyroRenderFrame) {
      return;
    }

    const renderGyroPosition = (): void => {
      if (!controlledMarker || Number.isNaN(gyroTargetPosition)) {
        gyroRenderFrame = 0;
        return;
      }

      const easedPosition = Number.isNaN(currentControlledPosition)
        ? gyroTargetPosition
        : currentControlledPosition + (gyroTargetPosition - currentControlledPosition) * GYRO_RENDER_EASE;

      updatePlayerPosition(easedPosition);
      gyroRenderFrame = requestAnimationFrame(renderGyroPosition);
    };

    gyroRenderFrame = requestAnimationFrame(renderGyroPosition);
  }

  function stopGyroRenderLoop(): void {
    cancelAnimationFrame(gyroRenderFrame);
    gyroRenderFrame = 0;
    gyroTargetPosition = Number.NaN;
  }

  async function startGyro(): Promise<void> {
    if (!controlledMarker) {
      return;
    }

    const motionResult = await initGyroControl(updateGyroPosition);

    if (motionResult.started) {
      motionButton.hidden = true;
      dismissMotionPermissionPrompt();
      controlStatus.hidden = true;
      controlStatus.textContent = "";
      return;
    }

    showControlStatus(getMotionFailureMessage(motionResult.reason));
  }

  function showMotionPermissionPrompt(): void {
    if (motionPermissionPrompt) {
      return;
    }

    const prompt = document.createElement("div");
    const title = document.createElement("p");
    const message = document.createElement("p");
    const button = document.createElement("button");

    prompt.className = "motion-permission-prompt";
    prompt.setAttribute("role", "dialog");
    prompt.setAttribute("aria-label", "Motion controls permission");
    prompt.setAttribute("data-motion-permission-prompt", "");
    title.className = "motion-permission-title";
    title.textContent = "Enable motion controls";
    message.className = "motion-permission-copy";
    message.textContent = "iPhone needs a tap here before gyro can control your player.";
    button.className = "pitch-action motion-permission-button";
    button.type = "button";
    button.textContent = "Tap to allow gyro";
    button.addEventListener("click", () => {
      void startGyro();
    }, { signal: listenerController.signal });
    prompt.append(title, message, button);
    pitchFrame.append(prompt);
    motionPermissionPrompt = prompt;
  }

  function dismissMotionPermissionPrompt(): void {
    motionPermissionPrompt?.remove();
    motionPermissionPrompt = null;
  }

  function sendControlledPosition(position: number, force = false): void {
    const now = performance.now();

    if (!force && now - lastSentAt < POSITION_SEND_INTERVAL_MS) {
      return;
    }

    if (!force && !Number.isNaN(lastSentPosition) && Math.abs(position - lastSentPosition) < POSITION_SEND_EPSILON) {
      return;
    }

    lastSentPosition = position;
    lastSentAt = now;
    handlers.onPositionChange?.(position);
  }

  function sendCheer(team: FoosballTeam): void {
    playCheerBurst(team);
    handlers.onCheer?.(team);
  }

  function showControlStatus(message: string): void {
    controlStatus.textContent = message;
    controlStatus.hidden = false;
  }

  function handleKickPointerDown(event: PointerEvent): void {
    if (!controlledMarker || isSpectator || matchFinished) {
      return;
    }

    if (isControlledMarkerTarget(event.target)) {
      const latestPosition = getPositionFromClientPoint(event.clientX, event.clientY);

      activeDrag = {
        pointerId: event.pointerId,
        latestPosition,
        animationFrame: 0
      };
      boundary.setPointerCapture(event.pointerId);
      updateControlledPositionFromPointer(event, true);
      startDragPositionStream();
      event.preventDefault();
      return;
    }

    activeSwipe = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startAt: event.timeStamp,
      previousX: event.clientX,
      previousY: event.clientY,
      previousAt: event.timeStamp,
      latestX: event.clientX,
      latestY: event.clientY,
      latestAt: event.timeStamp
    };
    boundary.setPointerCapture(event.pointerId);
  }

  function handleKickPointerMove(event: PointerEvent): void {
    if (activeDrag?.pointerId === event.pointerId) {
      updateControlledPositionFromPointer(event);
      event.preventDefault();
      return;
    }

    if (!activeSwipe || activeSwipe.pointerId !== event.pointerId) {
      return;
    }

    activeSwipe = {
      ...activeSwipe,
      previousX: activeSwipe.latestX,
      previousY: activeSwipe.latestY,
      previousAt: activeSwipe.latestAt,
      latestX: event.clientX,
      latestY: event.clientY,
      latestAt: event.timeStamp
    };
  }

  function handleKickPointerEnd(event: PointerEvent): void {
    if (activeDrag?.pointerId === event.pointerId) {
      updateControlledPositionFromPointer(event, true);
      stopDragPositionStream();
      releasePointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    if (!activeSwipe || activeSwipe.pointerId !== event.pointerId) {
      return;
    }

    const kickRequest = createKickRequest(
      activeSwipe,
      event,
      Date.now() - serverClockOffsetMs,
      Number.isNaN(currentControlledPosition) ? undefined : currentControlledPosition
    );

    activeSwipe = null;
    releasePointerCapture(event.pointerId);

    if (kickRequest) {
      handlers.onKick?.(kickRequest);
    }
  }

  function handleKickPointerCancel(event: PointerEvent): void {
    if (activeDrag?.pointerId === event.pointerId) {
      stopDragPositionStream();
      releasePointerCapture(event.pointerId);
      return;
    }

    if (activeSwipe?.pointerId !== event.pointerId) {
      return;
    }

    activeSwipe = null;
    releasePointerCapture(event.pointerId);
  }

  function releasePointerCapture(pointerId: number): void {
    if (boundary.hasPointerCapture(pointerId)) {
      boundary.releasePointerCapture(pointerId);
    }
  }

  function startDragPositionStream(): void {
    if (!activeDrag || activeDrag.animationFrame !== 0) {
      return;
    }

    const streamPosition = (): void => {
      if (!activeDrag) {
        return;
      }

      sendControlledPosition(activeDrag.latestPosition);
      activeDrag.animationFrame = requestAnimationFrame(streamPosition);
    };

    activeDrag.animationFrame = requestAnimationFrame(streamPosition);
  }

  function stopDragPositionStream(): void {
    if (!activeDrag) {
      return;
    }

    cancelAnimationFrame(activeDrag.animationFrame);
    activeDrag = null;
  }

  function isControlledMarkerTarget(target: EventTarget | null): boolean {
    return target instanceof Node
      && controlledMarker !== null
      && controlledMarker.element.contains(target);
  }

  function updateControlledPositionFromPointer(event: PointerEvent, forceSend = false): void {
    const position = getPositionFromClientPoint(event.clientX, event.clientY);

    if (activeDrag?.pointerId === event.pointerId) {
      activeDrag.latestPosition = position;
    }

    updatePlayerPosition(position, forceSend);
  }

  function handleDragTouchMove(event: TouchEvent): void {
    if (!activeDrag || event.touches.length === 0) {
      return;
    }

    const touch = event.touches[0];
    const position = getPositionFromClientPoint(touch.clientX, touch.clientY);

    activeDrag.latestPosition = position;
    updatePlayerPosition(position);
    event.preventDefault();
  }

  function getPositionFromClientPoint(clientX: number, clientY: number): number {
    const bounds = boundary.getBoundingClientRect();
    const usesHorizontalScreenAxis = window.matchMedia("(orientation: portrait) and (max-width: 900px)").matches;
    const pointerOffset = usesHorizontalScreenAxis
      ? (clientX - bounds.left) / bounds.width
      : (clientY - bounds.top) / bounds.height;
    const centeredPercent = (pointerOffset - 0.5) * 100;
    const position = clamp(centeredPercent / PLAYER_X_RANGE_PERCENT, -MAX_AUTONOMOUS_X, MAX_AUTONOMOUS_X);

    return isTeam2View ? -position : position;
  }

  function renderCheerCounts(): void {
    cheerCounts.replaceChildren(
      createCheerBadge("cheer-team1", "\u{1F4E3}", team1CheerCount),
      createCheerBadge("cheer-team2", "\u{1F941}", team2CheerCount)
    );
  }

  function playCheerBurst(team: FoosballTeam): void {
    playCheer();

    if (team === "team1Player") {
      team1CheerCount += 1;
    } else {
      team2CheerCount += 1;
    }

    renderCheerCounts();

    const burst = document.createElement("div");

    burst.className = `cheer-burst ${team}`;
    burst.textContent = "CHEER";
    cheerLayer.append(burst);

    window.setTimeout(() => burst.remove(), CHEER_BURST_DURATION_MS);
  }

  function updateBallState(ballState: BallMovementState): void {
    if (latestBallState && ballState.sequence <= latestBallState.sequence) {
      return;
    }

    const wasKickoffPause = latestBallState?.reason === "kickoff-pause";

    serverClockOffsetMs = Date.now() - ballState.serverTimestamp;
    latestBallState = ballState;
    ball.hidden = false;
    setBallSize(ball, ballState);
    visualBallPosition ??= getPredictedBallPosition(ballState, serverClockOffsetMs);
    startBallAnimation();

    if (wasKickoffPause && ballState.reason !== "kickoff-pause") {
      playWhistle();
    }

    if (ballState.reason === "kickoff-pause") {
      startKickoffCountdown(ballState);
    } else {
      stopKickoffCountdown();
    }
  }

  function startKickoffCountdown(ballState: BallMovementState): void {
    window.clearInterval(kickoffCountdownInterval);
    kickoffCountdown.classList.add("is-visible");

    const tick = (): void => {
      const elapsedMs = Date.now() - (ballState.serverTimestamp + serverClockOffsetMs);
      const remainingMs = KICKOFF_COUNTDOWN_MS - elapsedMs;

      if (remainingMs <= 0) {
        stopKickoffCountdown();
        return;
      }

      kickoffCountdown.textContent = String(Math.ceil(remainingMs / 1000));
    };

    tick();
    kickoffCountdownInterval = window.setInterval(tick, 200);
  }

  function stopKickoffCountdown(): void {
    window.clearInterval(kickoffCountdownInterval);
    kickoffCountdownInterval = undefined;
    kickoffCountdown.classList.remove("is-visible");
  }

  function startBallAnimation(): void {
    if (ballAnimationFrame !== 0) {
      return;
    }

    const renderBall = (): void => {
      if (!latestBallState) {
        ballAnimationFrame = 0;
        return;
      }

      const targetPosition = getPredictedBallPosition(latestBallState, serverClockOffsetMs);

      visualBallPosition = visualBallPosition
        ? interpolateVector(visualBallPosition, targetPosition, 0.35)
        : targetPosition;
      setBallPosition(ball, latestBallState, visualBallPosition);
      ballAnimationFrame = requestAnimationFrame(renderBall);
    };

    ballAnimationFrame = requestAnimationFrame(renderBall);
  }
}

function createCheerBadge(teamClass: string, icon: string, count: number): HTMLSpanElement {
  const badge = document.createElement("span");
  const iconElement = document.createElement("span");
  const countElement = document.createElement("span");

  badge.classList.add("cheer-badge", teamClass);
  iconElement.className = "emoji";
  iconElement.textContent = icon;
  countElement.className = "count";
  countElement.textContent = String(count);
  badge.append(iconElement, countElement);

  return badge;
}

function createKickRequest(
  swipe: SwipePointerState,
  event: PointerEvent,
  estimatedServerTimestamp: number,
  playerPosition?: number
): KickRequest | null {
  const totalX = event.clientX - swipe.startX;
  const totalY = event.clientY - swipe.startY;
  const distance = getVectorLength({ x: totalX, y: totalY });

  if (distance < MIN_KICK_SWIPE_DISTANCE) {
    return null;
  }

  const elapsedSeconds = Math.max((event.timeStamp - swipe.startAt) / 1000, 0.016);
  const recentSeconds = Math.max((event.timeStamp - swipe.previousAt) / 1000, 0.016);
  const recentDistance = getVectorLength({
    x: event.clientX - swipe.previousX,
    y: event.clientY - swipe.previousY
  });

  return {
    direction: normalizeVector({ x: totalX, y: totalY }),
    distance,
    velocity: Math.max(distance / elapsedSeconds, recentDistance / recentSeconds),
    clientTimestamp: estimatedServerTimestamp,
    playerPosition
  };
}

function buildPreviewPlayer(playerLayer: HTMLDivElement): PlayerMarkerState {
  const player = document.createElement("div");

  player.className = "player-marker preview-player";
  player.setAttribute("aria-label", "Player");
  player.style.setProperty("--player-y", "50%");
  setMarkerHorizontalPosition(player, 0);
  playerLayer.append(player);

  return {
    playerId: undefined,
    element: player,
    isControlled: true
  };
}

function buildGameplayPlayers(
  lobby: Lobby,
  currentPerson: ClientPerson | undefined,
  rodLayer: HTMLDivElement,
  playerLayer: HTMLDivElement,
  initialPositions: Record<string, number>
): PlayerMarkerState[] {
  const assignments = lobby.assignments ?? [];
  const controlledPlayerId = currentPerson?.type === "spectator" ? null : currentPerson?.id ?? null;
  const laneAssignments = [...new Map(assignments.map((assignment) => [
    `${assignment.team}:${assignment.role}`,
    assignment
  ])).values()].sort((first, second) => first.verticalLane - second.verticalLane);

  for (const assignment of laneAssignments) {
    rodLayer.append(createRodElement(assignment));
  }

  return assignments.map((assignment) => {
    const marker = createGameplayPlayerElement(assignment, assignment.id === controlledPlayerId);
    const initialPosition = initialPositions[assignment.id] ?? assignment.horizontalSlot;

    playerLayer.append(marker);
    setMarkerHorizontalPosition(marker, initialPosition);

    return {
      playerId: assignment.id,
      element: marker,
      isControlled: assignment.id === controlledPlayerId
    };
  });
}

function createRodElement(assignment: AssignedFoosballPlayer): HTMLDivElement {
  const rod = document.createElement("div");

  rod.className = `foosball-rod ${assignment.team}`;
  rod.style.setProperty("--rod-y", `${assignment.verticalLane}%`);
  rod.setAttribute("aria-hidden", "true");

  return rod;
}

function createGameplayPlayerElement(assignment: AssignedFoosballPlayer, isControlled: boolean): HTMLDivElement {
  const player = document.createElement("div");
  const name = document.createElement("span");

  player.className = `player-marker gameplay-player ${assignment.team}${isControlled ? " is-current" : ""}`;
  player.style.setProperty("--player-y", `${assignment.verticalLane}%`);
  player.setAttribute("aria-label", `${assignment.name}, ${getRoleLabel(assignment.role)}`);
  name.className = "player-name";
  name.textContent = assignment.name;
  player.append(name);

  return player;
}

function setMarkerHorizontalPosition(marker: HTMLDivElement, value: number): void {
  const clampedValue = Math.max(-MAX_AUTONOMOUS_X, Math.min(MAX_AUTONOMOUS_X, value));

  marker.style.setProperty("--player-x", `${clampedValue * PLAYER_X_RANGE_PERCENT}%`);
}

function getPredictedBallPosition(ballState: BallMovementState, serverClockOffsetMs: number): Vector2D {
  const elapsedSeconds = Math.max(0, (Date.now() - (ballState.serverTimestamp + serverClockOffsetMs)) / 1000);

  return {
    x: getReflectedAxisPosition(
      ballState.startPosition.x,
      ballState.velocity.x,
      elapsedSeconds,
      ballState.radius,
      ballState.field.width - ballState.radius
    ),
    y: getReflectedAxisPosition(
      ballState.startPosition.y,
      ballState.velocity.y,
      elapsedSeconds,
      ballState.radius,
      ballState.field.height - ballState.radius
    )
  };
}

function interpolateVector(start: Vector2D, end: Vector2D, amount: number): Vector2D {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount
  };
}

function setBallPosition(ball: HTMLDivElement, ballState: BallMovementState, position: Vector2D): void {
  ball.style.setProperty("--ball-x", `${(position.x / ballState.field.width) * 100}%`);
  ball.style.setProperty("--ball-y", `${(position.y / ballState.field.height) * 100}%`);
}

function setBallSize(ball: HTMLDivElement, ballState: BallMovementState): void {
  ball.style.setProperty("--ball-diameter-x", `${((ballState.radius * 2) / ballState.field.width) * 100}%`);
  ball.style.setProperty("--ball-diameter-y", `${((ballState.radius * 2) / ballState.field.height) * 100}%`);
}

function getReflectedAxisPosition(start: number, velocity: number, elapsedSeconds: number, min: number, max: number): number {
  const axisLength = max - min;

  if (axisLength <= 0 || velocity === 0) {
    return clamp(start, min, max);
  }

  const rawPosition = clamp(start, min, max) - min + velocity * elapsedSeconds;
  const period = axisLength * 2;
  const wrappedPosition = ((rawPosition % period) + period) % period;

  return min + (wrappedPosition <= axisLength ? wrappedPosition : period - wrappedPosition);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeVector(vector: Vector2D): Vector2D {
  const length = getVectorLength(vector);

  return length === 0 ? { x: 0, y: 0 } : { x: vector.x / length, y: vector.y / length };
}

function getVectorLength(vector: Vector2D): number {
  return Math.sqrt(vector.x * vector.x + vector.y * vector.y);
}

function getMotionFailureMessage(reason: "unsupported" | "permission-denied" | "permission-error" | "insecure-context"): string {
  if (reason === "insecure-context") {
    return "Motion is blocked on this network URL. Drag your highlighted player, or use HTTPS for tilt.";
  }

  if (reason === "permission-denied") {
    return "Motion permission was denied. Drag your highlighted player to move.";
  }

  if (reason === "permission-error") {
    return "Motion could not start. Drag your highlighted player to move.";
  }

  return "This browser does not support tilt controls. Drag your highlighted player to move.";
}

type StatRow = {
  assignment: AssignedFoosballPlayer;
  stats: PlayerStats;
};
type StatKey = "kicks" | "blocks" | "goals" | "ownGoals";

function getStatRows(lobby: Lobby): StatRow[] {
  return (lobby.assignments ?? []).map((assignment) => ({
    assignment,
    stats: lobby.playerStats[assignment.id] ?? createEmptyStats(assignment.id)
  }));
}

function getRankedStatRows(lobby: Lobby): StatRow[] {
  return getStatRows(lobby).sort(compareRankRows);
}

function getMvpPlayer(lobby: Lobby): StatRow | null {
  const rows = getRankedStatRows(lobby).filter(hasRecordedStats);

  if (rows.length === 0) {
    return null;
  }

  return rows[0];
}

function hasRecordedStats(row: StatRow): boolean {
  return row.stats.kicks > 0
    || row.stats.blocks > 0
    || row.stats.goals > 0
    || row.stats.ownGoals > 0;
}

function compareRankRows(first: StatRow, second: StatRow): number {
  if (hasRecordedStats(first) !== hasRecordedStats(second)) {
    return hasRecordedStats(first) ? -1 : 1;
  }

  return compareMvpRows(first, second);
}

function compareMvpRows(first: StatRow, second: StatRow): number {
  return second.stats.points - first.stats.points
    || second.stats.goals - first.stats.goals
    || second.stats.blocks - first.stats.blocks
    || second.stats.kicks - first.stats.kicks
    || first.stats.ownGoals - second.stats.ownGoals
    || first.assignment.name.localeCompare(second.assignment.name)
    || first.assignment.id.localeCompare(second.assignment.id);
}

function createEmptyStats(playerId: string): PlayerStats {
  return {
    playerId,
    kicks: 0,
    blocks: 0,
    goals: 0,
    ownGoals: 0,
    points: 0
  };
}

function getTeamName(lobby: Lobby, team: FoosballTeam): string {
  return team === "team1Player" ? lobby.teamNames.team1 : lobby.teamNames.team2;
}

function getFinalScoreText(lobby: Lobby): string {
  const scoreText = `${lobby.score.team1}-${lobby.score.team2}`;

  if (lobby.match?.winner === "team1") {
    return `${lobby.teamNames.team1} wins ${scoreText}`;
  }

  if (lobby.match?.winner === "team2") {
    return `${lobby.teamNames.team2} wins ${scoreText}`;
  }

  return `Draw ${scoreText}`;
}

function getStatLeaders(rows: StatRow[], statKey: StatKey): string {
  const highestValue = Math.max(0, ...rows.map((row) => row.stats[statKey]));

  if (highestValue === 0) {
    return "None";
  }

  const names = rows
    .filter((row) => row.stats[statKey] === highestValue)
    .map((row) => row.assignment.name);

  return `${names.join(", ")} (${highestValue})`;
}

function createLeaderItem(label: string, value: string): HTMLParagraphElement {
  const item = document.createElement("p");
  const labelElement = document.createElement("span");
  const valueElement = document.createElement("strong");

  labelElement.textContent = label;
  valueElement.textContent = value;
  item.append(labelElement, valueElement);
  return item;
}

function getRoleLabel(role: FoosballRole): string {
  if (role === "goalkeeper") {
    return "Goalkeeper";
  }

  if (role === "defender") {
    return "Defender";
  }

  if (role === "midfielder") {
    return "Midfielder";
  }

  return "Attacker";
}
