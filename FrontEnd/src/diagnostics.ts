import type { ClientPerson, Lobby } from "./types";

type DiagnosticContext = {
  lobbyCode: string;
  playerId: string;
  playerName: string;
  playerType: string;
};

type TimingStats = {
  count: number;
  firstAt: number | null;
  lastAt: number | null;
  minDeltaMs: number | null;
  maxDeltaMs: number | null;
  totalDeltaMs: number;
  over34Ms: number;
  over50Ms: number;
  over100Ms: number;
  over250Ms: number;
};

type SocketDiagnostics = {
  opens: number;
  closes: number;
  errors: number;
  messages: number;
  sends: number;
  queued: number;
  dropped: number;
  fallbackAttempts: number;
  pendingFlushes: number;
  lastReadyState: number | null;
  lastUrlIndex: number | null;
  closeCodes: number[];
  messageTypes: Record<string, number>;
  sentTypes: Record<string, number>;
  droppedTypes: Record<string, number>;
  lastError: string;
};

type MotionDiagnostics = {
  permissionRequests: number;
  permissionGranted: number;
  permissionDenied: number;
  permissionError: number;
  started: number;
  failed: number;
  orientationEvents: TimingStats;
  nullGammaEvents: number;
};

type RenderDiagnostics = {
  frames: TimingStats;
  localPositionUpdates: TimingStats;
  localPositionSends: TimingStats;
  remotePositionUpdates: TimingStats;
  styleWrites: number;
  layoutReads: number;
  pointerDowns: number;
  pointerMoves: TimingStats;
  touchMoves: TimingStats;
  dragStarts: number;
  dragEnds: number;
  kicks: number;
};

type DiagnosticsState = {
  startedAt: number;
  context: DiagnosticContext | null;
  visibilityChanges: number;
  lastVisibilityState: DocumentVisibilityState;
  socket: SocketDiagnostics;
  motion: MotionDiagnostics;
  render: RenderDiagnostics;
};

type DiagnosticsReport = {
  generatedAt: string;
  context: DiagnosticContext | null;
  match: {
    status: string;
    score: string;
    winner: string;
    durationMs: number;
  };
  browser: Record<string, unknown>;
  socket: SocketDiagnostics;
  motion: Record<string, unknown>;
  render: Record<string, unknown>;
  notes: string[];
};

const EMPTY_TIMING_STATS: TimingStats = {
  count: 0,
  firstAt: null,
  lastAt: null,
  minDeltaMs: null,
  maxDeltaMs: null,
  totalDeltaMs: 0,
  over34Ms: 0,
  over50Ms: 0,
  over100Ms: 0,
  over250Ms: 0
};

let diagnosticsState = createEmptyState();
let visibilityListenerAttached = false;

export function resetDiagnostics(lobby: Lobby, person: ClientPerson): void {
  diagnosticsState = createEmptyState({
    lobbyCode: lobby.code,
    playerId: person.id,
    playerName: person.name,
    playerType: person.type
  });
  attachVisibilityListener();
}

export function recordSocketOpen(urlIndex: number, readyState: number): void {
  diagnosticsState.socket.opens += 1;
  diagnosticsState.socket.lastUrlIndex = urlIndex;
  diagnosticsState.socket.lastReadyState = readyState;
}

export function recordSocketClose(code: number, readyState: number): void {
  diagnosticsState.socket.closes += 1;
  diagnosticsState.socket.closeCodes.push(code);
  diagnosticsState.socket.lastReadyState = readyState;
}

export function recordSocketError(message: string, readyState: number): void {
  diagnosticsState.socket.errors += 1;
  diagnosticsState.socket.lastError = message;
  diagnosticsState.socket.lastReadyState = readyState;
}

export function recordSocketFallback(): void {
  diagnosticsState.socket.fallbackAttempts += 1;
}

export function recordSocketMessage(type: string): void {
  diagnosticsState.socket.messages += 1;
  incrementRecord(diagnosticsState.socket.messageTypes, type);
}

export function recordSocketSend(type: string, readyState: number): void {
  diagnosticsState.socket.sends += 1;
  diagnosticsState.socket.lastReadyState = readyState;
  incrementRecord(diagnosticsState.socket.sentTypes, type);
}

export function recordSocketQueued(type: string, readyState: number): void {
  diagnosticsState.socket.queued += 1;
  diagnosticsState.socket.lastReadyState = readyState;
  incrementRecord(diagnosticsState.socket.sentTypes, `${type}:queued`);
}

export function recordSocketDropped(type: string, readyState: number): void {
  diagnosticsState.socket.dropped += 1;
  diagnosticsState.socket.lastReadyState = readyState;
  incrementRecord(diagnosticsState.socket.droppedTypes, type);
}

export function recordSocketPendingFlush(count: number): void {
  diagnosticsState.socket.pendingFlushes += count;
}

export function recordMotionPermission(result: "granted" | "denied" | "error"): void {
  diagnosticsState.motion.permissionRequests += 1;

  if (result === "granted") {
    diagnosticsState.motion.permissionGranted += 1;
  } else if (result === "denied") {
    diagnosticsState.motion.permissionDenied += 1;
  } else {
    diagnosticsState.motion.permissionError += 1;
  }
}

export function recordMotionStart(started: boolean): void {
  if (started) {
    diagnosticsState.motion.started += 1;
  } else {
    diagnosticsState.motion.failed += 1;
  }
}

export function recordOrientationEvent(hasGamma: boolean): void {
  recordTiming(diagnosticsState.motion.orientationEvents);

  if (!hasGamma) {
    diagnosticsState.motion.nullGammaEvents += 1;
  }
}

export function recordFrame(): void {
  recordTiming(diagnosticsState.render.frames);
}

export function recordLocalPositionUpdate(): void {
  recordTiming(diagnosticsState.render.localPositionUpdates);
}

export function recordLocalPositionSend(): void {
  recordTiming(diagnosticsState.render.localPositionSends);
}

export function recordRemotePositionUpdate(): void {
  recordTiming(diagnosticsState.render.remotePositionUpdates);
}

export function recordStyleWrite(): void {
  diagnosticsState.render.styleWrites += 1;
}

export function recordLayoutRead(): void {
  diagnosticsState.render.layoutReads += 1;
}

export function recordPointerDown(): void {
  diagnosticsState.render.pointerDowns += 1;
}

export function recordPointerMove(): void {
  recordTiming(diagnosticsState.render.pointerMoves);
}

export function recordTouchMove(): void {
  recordTiming(diagnosticsState.render.touchMoves);
}

export function recordDragStart(): void {
  diagnosticsState.render.dragStarts += 1;
}

export function recordDragEnd(): void {
  diagnosticsState.render.dragEnds += 1;
}

export function recordKick(): void {
  diagnosticsState.render.kicks += 1;
}

export function createDiagnosticsReport(lobby: Lobby | null, person: ClientPerson | undefined): DiagnosticsReport {
  const now = performance.now();
  const durationMs = Math.max(1, now - diagnosticsState.startedAt);

  return {
    generatedAt: new Date().toISOString(),
    context: diagnosticsState.context ?? (lobby && person ? {
      lobbyCode: lobby.code,
      playerId: person.id,
      playerName: person.name,
      playerType: person.type
    } : null),
    match: {
      status: lobby?.match?.status ?? "unknown",
      score: lobby ? `${lobby.teamNames.team1} ${lobby.score.team1} - ${lobby.score.team2} ${lobby.teamNames.team2}` : "unknown",
      winner: getWinnerLabel(lobby),
      durationMs: roundNumber(durationMs)
    },
    browser: readBrowserSpecs(),
    socket: {
      ...diagnosticsState.socket,
      closeCodes: [...diagnosticsState.socket.closeCodes],
      messageTypes: { ...diagnosticsState.socket.messageTypes },
      sentTypes: { ...diagnosticsState.socket.sentTypes },
      droppedTypes: { ...diagnosticsState.socket.droppedTypes }
    },
    motion: {
      ...diagnosticsState.motion,
      orientationEvents: summarizeTiming(diagnosticsState.motion.orientationEvents, durationMs)
    },
    render: {
      frames: summarizeTiming(diagnosticsState.render.frames, durationMs),
      localPositionUpdates: summarizeTiming(diagnosticsState.render.localPositionUpdates, durationMs),
      localPositionSends: summarizeTiming(diagnosticsState.render.localPositionSends, durationMs),
      remotePositionUpdates: summarizeTiming(diagnosticsState.render.remotePositionUpdates, durationMs),
      pointerMoves: summarizeTiming(diagnosticsState.render.pointerMoves, durationMs),
      touchMoves: summarizeTiming(diagnosticsState.render.touchMoves, durationMs),
      styleWrites: diagnosticsState.render.styleWrites,
      layoutReads: diagnosticsState.render.layoutReads,
      pointerDowns: diagnosticsState.render.pointerDowns,
      dragStarts: diagnosticsState.render.dragStarts,
      dragEnds: diagnosticsState.render.dragEnds,
      kicks: diagnosticsState.render.kicks,
      visibilityChanges: diagnosticsState.visibilityChanges,
      lastVisibilityState: diagnosticsState.lastVisibilityState
    },
    notes: createDiagnosticNotes(durationMs)
  };
}

export function formatDiagnosticsReport(report: DiagnosticsReport): string {
  return JSON.stringify(report, null, 2);
}

function createEmptyState(context: DiagnosticContext | null = null): DiagnosticsState {
  return {
    startedAt: performance.now(),
    context,
    visibilityChanges: 0,
    lastVisibilityState: document.visibilityState,
    socket: {
      opens: 0,
      closes: 0,
      errors: 0,
      messages: 0,
      sends: 0,
      queued: 0,
      dropped: 0,
      fallbackAttempts: 0,
      pendingFlushes: 0,
      lastReadyState: null,
      lastUrlIndex: null,
      closeCodes: [],
      messageTypes: {},
      sentTypes: {},
      droppedTypes: {},
      lastError: ""
    },
    motion: {
      permissionRequests: 0,
      permissionGranted: 0,
      permissionDenied: 0,
      permissionError: 0,
      started: 0,
      failed: 0,
      orientationEvents: createTimingStats(),
      nullGammaEvents: 0
    },
    render: {
      frames: createTimingStats(),
      localPositionUpdates: createTimingStats(),
      localPositionSends: createTimingStats(),
      remotePositionUpdates: createTimingStats(),
      styleWrites: 0,
      layoutReads: 0,
      pointerDowns: 0,
      pointerMoves: createTimingStats(),
      touchMoves: createTimingStats(),
      dragStarts: 0,
      dragEnds: 0,
      kicks: 0
    }
  };
}

function attachVisibilityListener(): void {
  if (visibilityListenerAttached) {
    return;
  }

  document.addEventListener("visibilitychange", () => {
    diagnosticsState.visibilityChanges += 1;
    diagnosticsState.lastVisibilityState = document.visibilityState;
  });
  visibilityListenerAttached = true;
}

function createTimingStats(): TimingStats {
  return { ...EMPTY_TIMING_STATS };
}

function recordTiming(stats: TimingStats): void {
  const now = performance.now();

  if (stats.lastAt !== null) {
    const delta = now - stats.lastAt;

    stats.minDeltaMs = stats.minDeltaMs === null ? delta : Math.min(stats.minDeltaMs, delta);
    stats.maxDeltaMs = stats.maxDeltaMs === null ? delta : Math.max(stats.maxDeltaMs, delta);
    stats.totalDeltaMs += delta;

    if (delta > 34) {
      stats.over34Ms += 1;
    }

    if (delta > 50) {
      stats.over50Ms += 1;
    }

    if (delta > 100) {
      stats.over100Ms += 1;
    }

    if (delta > 250) {
      stats.over250Ms += 1;
    }
  }

  stats.count += 1;
  stats.firstAt ??= now;
  stats.lastAt = now;
}

function summarizeTiming(stats: TimingStats, durationMs: number): Record<string, number | null> {
  const intervalCount = Math.max(0, stats.count - 1);

  return {
    count: stats.count,
    perSecond: roundNumber((stats.count / durationMs) * 1000),
    averageDeltaMs: intervalCount > 0 ? roundNumber(stats.totalDeltaMs / intervalCount) : null,
    minDeltaMs: roundNullable(stats.minDeltaMs),
    maxDeltaMs: roundNullable(stats.maxDeltaMs),
    over34Ms: stats.over34Ms,
    over50Ms: stats.over50Ms,
    over100Ms: stats.over100Ms,
    over250Ms: stats.over250Ms
  };
}

function readBrowserSpecs(): Record<string, unknown> {
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  const orientation = screen.orientation;

  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    vendor: navigator.vendor,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigatorWithMemory.deviceMemory ?? "unknown",
    maxTouchPoints: navigator.maxTouchPoints,
    cookieEnabled: navigator.cookieEnabled,
    online: navigator.onLine,
    visibilityState: document.visibilityState,
    secureContext: window.isSecureContext,
    protocol: window.location.protocol,
    host: window.location.host,
    devicePixelRatio: window.devicePixelRatio,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${screen.width}x${screen.height}`,
    orientationType: orientation?.type ?? "unknown",
    orientationAngle: orientation?.angle ?? "unknown",
    pointerEvents: "PointerEvent" in window,
    touchEvents: "ontouchstart" in window,
    deviceOrientationEvent: "DeviceOrientationEvent" in window,
    deviceMotionEvent: "DeviceMotionEvent" in window,
    canUseWebSocket: "WebSocket" in window,
    cssTouchAction: CSS.supports("touch-action", "none"),
    cssTransform: CSS.supports("transform", "translate3d(0, 0, 0)"),
    cssWillChange: CSS.supports("will-change", "transform")
  };
}

function createDiagnosticNotes(durationMs: number): string[] {
  const notes: string[] = [];
  const render = diagnosticsState.render;
  const socket = diagnosticsState.socket;
  const motion = diagnosticsState.motion;
  const frameSummary = summarizeTiming(render.frames, durationMs);

  if (typeof frameSummary.averageDeltaMs === "number" && frameSummary.averageDeltaMs > 24) {
    notes.push("Average animation frame interval is high. This supports a local rendering/frame-rate bottleneck.");
  }

  if (render.frames.over50Ms > 0 || render.frames.over100Ms > 0) {
    notes.push("Some animation frames took longer than 50ms/100ms. This supports jank or page suspension.");
  }

  if (render.localPositionUpdates.count > render.localPositionSends.count * 2 && render.localPositionSends.count > 0) {
    notes.push("Local position updates are much more frequent than socket sends. Outbound throttling is active.");
  }

  if (render.layoutReads > 0 && render.styleWrites > 0) {
    notes.push("The game performed layout reads and style writes during movement. That can be expensive on iOS.");
  }

  if (socket.dropped > 0 || socket.closes > 0 || socket.errors > 0) {
    notes.push("Socket drops, closes, or errors were observed. This supports a stale connection or reconnect issue.");
  }

  if (!window.isSecureContext && motion.permissionRequests > 0) {
    notes.push("Motion permission was requested from a non-secure context. iOS can block motion sensors here.");
  }

  if (motion.permissionDenied > 0 || motion.permissionError > 0) {
    notes.push("Motion permission was denied or errored. The permission prompt path needs attention.");
  }

  if (notes.length === 0) {
    notes.push("No single metric crossed the built-in warning thresholds. Compare this JSON between smooth and laggy phones.");
  }

  return notes;
}

function getWinnerLabel(lobby: Lobby | null): string {
  if (!lobby?.match?.winner) {
    return "none";
  }

  return lobby.match.winner === "team1" ? lobby.teamNames.team1 : lobby.teamNames.team2;
}

function incrementRecord(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function roundNullable(value: number | null): number | null {
  return value === null ? null : roundNumber(value);
}

function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
}
