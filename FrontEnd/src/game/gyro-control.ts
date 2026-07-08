/**
 * Reusable side-to-side tilt control.
 * Gives a smoothed -1..1 value via a callback so any game screen can map it
 * into its own coordinate system.
 */

interface DevicePermissionEvent {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export type TiltCallback = (tilt: number) => void;
export type GyroPermissionResult =
  | {
      granted: true;
    }
  | {
      granted: false;
      reason: "permission-denied" | "permission-error";
    };

export type GyroStartResult =
  | {
      started: true;
    }
  | {
      started: false;
      reason: "unsupported" | "permission-denied" | "permission-error" | "insecure-context";
    };

const SMOOTHING = 0.1;
const GAMMA_RANGE = 30;
const TILT_DEADBAND = 0.025;
const EMIT_EPSILON = 0.008;

let rawGamma = 0;
let smoothGamma = 0;
let lastEmittedTilt = 0;
let onUpdate: TiltCallback | null = null;
let isListening = false;

export function needsGyroPermission(): boolean {
  return getMotionPermissionEvent() !== null;
}

export function canUseGyroControl(): boolean {
  return typeof DeviceOrientationEvent !== "undefined"
    || typeof DeviceMotionEvent !== "undefined"
    || needsGyroPermission();
}

export async function requestGyroPermission(): Promise<GyroPermissionResult> {
  const permissionEvent = getMotionPermissionEvent();

  if (!permissionEvent) {
    return { granted: true };
  }

  try {
    const result = await permissionEvent.requestPermission!();

    if (result !== "granted") {
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
  onUpdate = onUpdateCallback;

  if (!canUseGyroControl()) {
    return {
      started: false,
      reason: window.isSecureContext ? "unsupported" : "insecure-context"
    };
  }

  if (typeof DeviceOrientationEvent === "undefined" && typeof DeviceMotionEvent === "undefined") {
    return {
      started: false,
      reason: "unsupported"
    };
  }

  startListening();
  return { started: true };
}

export function stopGyroControl(): void {
  if (isListening) {
    window.removeEventListener("deviceorientation", handleOrientation, true);
    isListening = false;
  }

  rawGamma = 0;
  smoothGamma = 0;
  lastEmittedTilt = 0;
  onUpdate = null;
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

  window.addEventListener("deviceorientation", handleOrientation, true);
  window.addEventListener("deviceorientationabsolute", handleOrientation, true);
  window.addEventListener("devicemotion", handleMotion, true);
  isListening = true;
}

function handleOrientation(event: DeviceOrientationEvent): void {
  if (event.gamma === null) {
    return;
  }

  rawGamma = event.gamma;

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

  const targetTilt = Math.max(-1, Math.min(1, -gravityX / 9.81));

  smoothGamma += (targetTilt - smoothGamma) * SMOOTHING;
  const tilt = Math.abs(smoothGamma) < TILT_DEADBAND ? 0 : smoothGamma;

  if (Math.abs(tilt - lastEmittedTilt) < EMIT_EPSILON) {
    return;
  }

  lastEmittedTilt = tilt;
  onUpdate?.(tilt);
}

function getMotionPermissionEvent(): DevicePermissionEvent | null {
  const DeviceOrientationEventClass = typeof DeviceOrientationEvent !== "undefined"
    ? (DeviceOrientationEvent as unknown as DevicePermissionEvent)
    : null;

  if (DeviceOrientationEventClass && typeof DeviceOrientationEventClass.requestPermission === "function") {
    return DeviceOrientationEventClass;
  }

  const DeviceMotionEventClass = typeof DeviceMotionEvent !== "undefined"
    ? (DeviceMotionEvent as unknown as DevicePermissionEvent)
    : null;

  if (DeviceMotionEventClass && typeof DeviceMotionEventClass.requestPermission === "function") {
    return DeviceMotionEventClass;
  }

  return null;
}
