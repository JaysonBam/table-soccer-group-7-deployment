/**
 * Reusable side-to-side tilt control.
 * Gives a smoothed -1..1 value via a callback so any game screen can map it
 * into its own coordinate system.
 */

interface MotionPermissionEventClass {
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

const SMOOTHING = 0.12;
const GAMMA_RANGE = 35;
const INPUT_DEADZONE = 0.06;
const OUTPUT_EPSILON = 0.01;
const CALIBRATION_SAMPLES = 12;

let rawGamma = 0;
let smoothGamma = 0;
let baselineGamma = 0;
let calibrationCount = 0;
let calibrationTotal = 0;
let lastOutputTilt = 0;
let onUpdate: TiltCallback | null = null;
let isListening = false;

export function needsGyroPermission(): boolean {
  return getPermissionRequester() !== null;
}

export function canUseGyroControl(): boolean {
  return typeof DeviceOrientationEvent !== "undefined";
}

export async function initGyroControl(onUpdateCallback: TiltCallback): Promise<GyroStartResult> {
  onUpdate = onUpdateCallback;

  if (typeof DeviceOrientationEvent === "undefined") {
    return {
      started: false,
      reason: window.isSecureContext ? "unsupported" : "insecure-context"
    };
  }

  if (!window.isSecureContext) {
    return {
      started: false,
      reason: "insecure-context"
    };
  }

  const requestPermission = getPermissionRequester();

  if (requestPermission) {
    try {
      const result = await requestPermission();

      if (result === "granted") {
        startListening();
        return { started: true };
      }

      return {
        started: false,
        reason: "permission-denied"
      };
    } catch {
      return {
        started: false,
        reason: "permission-error"
      };
    }
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
  baselineGamma = 0;
  calibrationCount = 0;
  calibrationTotal = 0;
  lastOutputTilt = 0;
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

  rawGamma = 0;
  smoothGamma = 0;
  baselineGamma = 0;
  calibrationCount = 0;
  calibrationTotal = 0;
  lastOutputTilt = 0;

  window.addEventListener("deviceorientation", handleOrientation, true);
  isListening = true;
}

function handleOrientation(event: DeviceOrientationEvent): void {
  if (event.gamma === null) {
    return;
  }

  rawGamma = event.gamma;

  if (calibrationCount < CALIBRATION_SAMPLES) {
    calibrationTotal += rawGamma;
    calibrationCount += 1;
    baselineGamma = calibrationTotal / calibrationCount;
  }

  const centeredGamma = rawGamma - baselineGamma;
  let targetGamma = Math.max(-1, Math.min(1, centeredGamma / GAMMA_RANGE));

  if (Math.abs(targetGamma) < INPUT_DEADZONE) {
    targetGamma = 0;
  } else {
    const adjustedMagnitude = (Math.abs(targetGamma) - INPUT_DEADZONE) / (1 - INPUT_DEADZONE);

    targetGamma = Math.sign(targetGamma) * adjustedMagnitude;
  }

  smoothGamma += (targetGamma - smoothGamma) * SMOOTHING;

  if (Math.abs(smoothGamma - lastOutputTilt) < OUTPUT_EPSILON) {
    return;
  }

  lastOutputTilt = smoothGamma;
  onUpdate?.(smoothGamma);
}

function getPermissionRequester(): (() => Promise<"granted" | "denied">) | null {
  if (typeof DeviceOrientationEvent !== "undefined") {
    const orientationClass = DeviceOrientationEvent as unknown as MotionPermissionEventClass;

    if (typeof orientationClass.requestPermission === "function") {
      return orientationClass.requestPermission.bind(orientationClass);
    }
  }

  if (typeof DeviceMotionEvent !== "undefined") {
    const motionClass = DeviceMotionEvent as unknown as MotionPermissionEventClass;

    if (typeof motionClass.requestPermission === "function") {
      return motionClass.requestPermission.bind(motionClass);
    }
  }

  return null;
}
