/**
 * Reusable side-to-side tilt control.
 * Gives a smoothed -1..1 value via a callback so any game screen can map it
 * into its own coordinate system.
 */

interface DeviceMotionPermissionEvent {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export type TiltCallback = (tilt: number) => void;
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
  return typeof DeviceOrientationEvent !== "undefined" || needsGyroPermission();
}

export async function initGyroControl(onUpdateCallback: TiltCallback): Promise<GyroStartResult> {
  onUpdate = onUpdateCallback;

  if (!canUseGyroControl()) {
    return {
      started: false,
      reason: window.isSecureContext ? "unsupported" : "insecure-context"
    };
  }

  const permissionEvent = getMotionPermissionEvent();

  if (permissionEvent) {
    try {
      const result = await permissionEvent.requestPermission!();

      if (result !== "granted") {
        return {
          started: false,
          reason: "permission-denied"
        };
      }
    } catch {
      return {
        started: false,
        reason: "permission-error"
      };
    }
  }

  if (typeof DeviceOrientationEvent === "undefined") {
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

function getMotionPermissionEvent(): DeviceMotionPermissionEvent | null {
  if (typeof DeviceOrientationEvent !== "undefined") {
    const DeviceOrientationEventClass = DeviceOrientationEvent as unknown as DeviceMotionPermissionEvent;

    if (typeof DeviceOrientationEventClass.requestPermission === "function") {
      return DeviceOrientationEventClass;
    }
  }

  if (typeof DeviceMotionEvent !== "undefined") {
    const DeviceMotionEventClass = DeviceMotionEvent as unknown as DeviceMotionPermissionEvent;

    if (typeof DeviceMotionEventClass.requestPermission === "function") {
      return DeviceMotionEventClass;
    }
  }

  return null;
}
