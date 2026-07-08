/**
 * Reusable side-to-side tilt control.
 * Gives a smoothed -1..1 value via a callback so any game screen can map it
 * into its own coordinate system.
 */

interface DevicePermissionEvent {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export type TiltCallback = (tilt: number) => void;
export type MotionSensorActivityCallback = () => void;
export type GyroPermissionResult =
  | {
      granted: true;
    }
  | {
      granted: false;
      reason: "permission-denied" | "permission-error" | "unsupported" | "insecure-context";
    };

export type GyroStartResult =
  | {
      started: true;
    }
  | {
      started: false;
      reason: "unsupported" | "permission-denied" | "permission-error" | "insecure-context" | "timeout";
    };

export type MotionControlSupport = {
  secureContext: boolean;
  orientationEventAvailable: boolean;
  motionEventAvailable: boolean;
  orientationPermissionRequired: boolean;
  motionPermissionRequired: boolean;
  requiresPermission: boolean;
  supported: boolean;
  reason: "unsupported" | "insecure-context" | null;
};

const SMOOTHING = 0.1;
const GAMMA_RANGE = 30;
const TILT_DEADBAND = 0.025;
const EMIT_EPSILON = 0.008;
const DEBUG_EVENT_LOG_LIMIT = 3;

let rawGamma = 0;
let smoothGamma = 0;
let lastEmittedTilt = 0;
let onUpdate: TiltCallback | null = null;
let onMotionActivity: MotionSensorActivityCallback | null = null;
let isListening = false;
let debugEventCount = 0;

export function needsGyroPermission(): boolean {
  return getMotionControlSupport().requiresPermission;
}

export function canUseGyroControl(): boolean {
  return getMotionControlSupport().supported;
}

export function getMotionControlSupport(): MotionControlSupport {
  const secureContext = typeof window !== "undefined" ? window.isSecureContext : false;
  const orientationEventAvailable = typeof DeviceOrientationEvent !== "undefined";
  const motionEventAvailable = typeof DeviceMotionEvent !== "undefined";
  const orientationPermissionRequired = orientationEventAvailable
    && typeof (DeviceOrientationEvent as unknown as DevicePermissionEvent).requestPermission === "function";
  const motionPermissionRequired = motionEventAvailable
    && typeof (DeviceMotionEvent as unknown as DevicePermissionEvent).requestPermission === "function";
  const supported = secureContext && (orientationEventAvailable || motionEventAvailable);

  return {
    secureContext,
    orientationEventAvailable,
    motionEventAvailable,
    orientationPermissionRequired,
    motionPermissionRequired,
    requiresPermission: orientationPermissionRequired || motionPermissionRequired,
    supported,
    reason: secureContext ? (supported ? null : "unsupported") : "insecure-context"
  };
}

export async function requestGyroPermission(): Promise<GyroPermissionResult> {
  const support = getMotionControlSupport();

  logMotionDebug("permission-request-start", support);

  if (!support.secureContext) {
    return {
      granted: false,
      reason: "insecure-context"
    };
  }

  if (!support.supported) {
    return {
      granted: false,
      reason: "unsupported"
    };
  }

  const permissionRequests: Array<Promise<"granted" | "denied">> = [];

  const orientationPermissionEvent = getOrientationPermissionEvent();
  if (orientationPermissionEvent) {
    permissionRequests.push(orientationPermissionEvent.requestPermission!());
  }

  const motionPermissionEvent = getMotionPermissionEvent();
  if (motionPermissionEvent && motionPermissionEvent !== orientationPermissionEvent) {
    permissionRequests.push(motionPermissionEvent.requestPermission!());
  }

  if (permissionRequests.length === 0) {
    logMotionDebug("permission-request-skip", { reason: "no-explicit-permission-api" });
    return { granted: true };
  }

  try {
    const results = await Promise.all(permissionRequests);
    const granted = results.every((result) => result === "granted");

    logMotionDebug("permission-request-result", { results });

    if (!granted) {
      return {
        granted: false,
        reason: "permission-denied"
      };
    }

    return { granted: true };
  } catch {
    return {
      granted: false,
      reason: "permission-error"
    };
  }
}

export async function initGyroControl(onUpdateCallback: TiltCallback): Promise<GyroStartResult> {
  return initGyroControlWithActivity(onUpdateCallback);
}

export async function initGyroControlWithActivity(
  onUpdateCallback: TiltCallback,
  onMotionActivityCallback: MotionSensorActivityCallback | null = null
): Promise<GyroStartResult> {
  onUpdate = onUpdateCallback;
  onMotionActivity = onMotionActivityCallback;
  debugEventCount = 0;

  const support = getMotionControlSupport();

  if (!support.secureContext) {
    return {
      started: false,
      reason: "insecure-context"
    };
  }

  if (!support.supported) {
    return {
      started: false,
      reason: "unsupported"
    };
  }

  logMotionDebug("listener-start", support);
  startListening();
  return { started: true };
}

export function stopGyroControl(): void {
  if (isListening) {
    window.removeEventListener("deviceorientation", handleOrientation, true);
    window.removeEventListener("deviceorientationabsolute", handleOrientation, true);
    window.removeEventListener("devicemotion", handleMotion, true);
    isListening = false;
  }

  rawGamma = 0;
  smoothGamma = 0;
  lastEmittedTilt = 0;
  onUpdate = null;
  onMotionActivity = null;
}

export function initKeyboardFallback(onUpdateCallback: TiltCallback): () => void {
  onUpdate = onUpdateCallback;
  let keyGamma = 0;

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "ArrowLeft") {
      keyGamma = Math.max(-1, keyGamma - 0.15);
    } else if (event.key === "ArrowRight") {
      keyGamma = Math.min(1, keyGamma + 0.15);
    } else {
      return;
    }

    onUpdate?.(keyGamma);
  };

  window.addEventListener("keydown", handleKeyDown);

  return () => window.removeEventListener("keydown", handleKeyDown);
}

function startListening(): void {
  if (isListening) {
    return;
  }

  if (typeof DeviceOrientationEvent !== "undefined") {
    window.addEventListener("deviceorientation", handleOrientation, true);
    window.addEventListener("deviceorientationabsolute", handleOrientation, true);
  }

  if (typeof DeviceMotionEvent !== "undefined") {
    window.addEventListener("devicemotion", handleMotion, true);
  }

  isListening = true;
}

function handleOrientation(event: DeviceOrientationEvent): void {
  if (event.gamma === null) {
    return;
  }

  rawGamma = event.gamma;
  onMotionActivity?.();
  logSensorEvent("deviceorientation", {
    gamma: event.gamma,
    alpha: event.alpha,
    beta: event.beta,
    absolute: event.absolute
  });

  const targetGamma = Math.max(-1, Math.min(1, rawGamma / GAMMA_RANGE));

  smoothGamma += (targetGamma - smoothGamma) * SMOOTHING;
  const tilt = Math.abs(smoothGamma) < TILT_DEADBAND ? 0 : smoothGamma;

  if (Math.abs(tilt - lastEmittedTilt) < EMIT_EPSILON) {
    return;
  }

  lastEmittedTilt = tilt;
  onUpdate?.(tilt);
}

function handleMotion(event: DeviceMotionEvent): void {
  const gravityX = event.accelerationIncludingGravity?.x;

  if (gravityX === null || gravityX === undefined) {
    return;
  }

  onMotionActivity?.();
  logSensorEvent("devicemotion", {
    rotationRate: event.rotationRate,
    accelerationIncludingGravity: event.accelerationIncludingGravity,
    interval: event.interval
  });

  const targetTilt = Math.max(-1, Math.min(1, -gravityX / 9.81));

  smoothGamma += (targetTilt - smoothGamma) * SMOOTHING;
  const tilt = Math.abs(smoothGamma) < TILT_DEADBAND ? 0 : smoothGamma;

  if (Math.abs(tilt - lastEmittedTilt) < EMIT_EPSILON) {
    return;
  }

  lastEmittedTilt = tilt;
  onUpdate?.(tilt);
}

function getOrientationPermissionEvent(): DevicePermissionEvent | null {
  const DeviceOrientationEventClass = typeof DeviceOrientationEvent !== "undefined"
    ? (DeviceOrientationEvent as unknown as DevicePermissionEvent)
    : null;

  if (DeviceOrientationEventClass && typeof DeviceOrientationEventClass.requestPermission === "function") {
    return DeviceOrientationEventClass;
  }

  return null;
}

function getMotionPermissionEvent(): DevicePermissionEvent | null {
  const DeviceMotionEventClass = typeof DeviceMotionEvent !== "undefined"
    ? (DeviceMotionEvent as unknown as DevicePermissionEvent)
    : null;

  if (DeviceMotionEventClass && typeof DeviceMotionEventClass.requestPermission === "function") {
    return DeviceMotionEventClass;
  }

  return null;
}

function logMotionDebug(label: string, details?: unknown): void {
  if (!import.meta.env.DEV) {
    return;
  }

  console.debug(`[motion] ${label}`, details ?? "");
}

function logSensorEvent(source: string, details: Record<string, unknown>): void {
  if (!import.meta.env.DEV || debugEventCount >= DEBUG_EVENT_LOG_LIMIT) {
    return;
  }

  debugEventCount += 1;
  console.debug(`[motion] ${source} event #${debugEventCount}`, details);
}
