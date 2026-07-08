import { canUseGyroControl, initGyroControl, needsGyroPermission, stopGyroControl } from "../game/gyro-control";

type PermissionEventConstructor = {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export function renderGyroTestView(screen: HTMLElement): () => void {
  const listenerController = new AbortController();
  let latestTilt = 0;
  let orientationEvents = 0;
  let motionEvents = 0;

  screen.replaceChildren();
  screen.className = "page page-narrow gyro-test-page";
  screen.innerHTML = `
    <header class="page-header">
      <h1>Gyro test</h1>
      <p class="muted">Use this page on an iPhone to test motion permission and tilt without joining a full game.</p>
    </header>
    <section class="gyro-test-panel">
      <button class="button primary" type="button" data-gyro-test-start>Enable motion</button>
      <p class="status-message" data-gyro-test-status>Ready to request motion permission.</p>
      <p class="gyro-test-readout" data-gyro-test-readout>Tilt: 0.000</p>
      <dl class="gyro-test-details" data-gyro-test-details></dl>
    </section>
    <a class="button secondary gyro-test-link" href="/">Back to game</a>
  `;

  const startButton = screen.querySelector<HTMLButtonElement>("[data-gyro-test-start]")!;
  const status = screen.querySelector<HTMLParagraphElement>("[data-gyro-test-status]")!;
  const readout = screen.querySelector<HTMLParagraphElement>("[data-gyro-test-readout]")!;
  const details = screen.querySelector<HTMLDListElement>("[data-gyro-test-details]")!;

  details.replaceChildren(...createDetailRows());
  window.addEventListener("deviceorientation", () => {
    orientationEvents += 1;
    details.replaceChildren(...createDetailRows());
  }, { signal: listenerController.signal });
  window.addEventListener("devicemotion", () => {
    motionEvents += 1;
    details.replaceChildren(...createDetailRows());
  }, { signal: listenerController.signal });

  startButton.addEventListener("click", () => {
    startButton.disabled = true;
    status.textContent = "Requesting motion permission...";

    void initGyroControl((tilt) => {
      latestTilt = tilt;
      readout.textContent = `Tilt: ${latestTilt.toFixed(3)}`;
    }).then((result) => {
      details.replaceChildren(...createDetailRows());

      if (result.started) {
        status.textContent = "Motion started. Tilt the phone left and right.";
        return;
      }

      startButton.disabled = false;
      status.textContent = getFailureMessage(result.reason);
    });
  }, { signal: listenerController.signal });

  return () => {
    listenerController.abort();
    stopGyroControl();
  };

  function createDetailRows(): HTMLElement[] {
    return [
      createDetailRow("Secure context", window.isSecureContext ? "yes" : "no"),
      createDetailRow("Can use gyro", canUseGyroControl() ? "yes" : "no"),
      createDetailRow("Needs permission", needsGyroPermission() ? "yes" : "no"),
      createDetailRow("Orientation API", getConstructorState("DeviceOrientationEvent")),
      createDetailRow("Motion API", getConstructorState("DeviceMotionEvent")),
      createDetailRow("Orientation events", String(orientationEvents)),
      createDetailRow("Motion events", String(motionEvents))
    ];
  }
}

function createDetailRow(label: string, value: string): HTMLElement {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");

  term.textContent = label;
  description.textContent = value;
  wrapper.append(term, description);

  return wrapper;
}

function getConstructorState(name: "DeviceMotionEvent" | "DeviceOrientationEvent"): string {
  const eventConstructor = window[name] as unknown as PermissionEventConstructor | undefined;

  if (!eventConstructor) {
    return "missing";
  }

  return typeof eventConstructor.requestPermission === "function" ? "permission API" : "available";
}

function getFailureMessage(reason: "unsupported" | "permission-denied" | "permission-error" | "insecure-context"): string {
  if (reason === "insecure-context") {
    return "Motion is blocked because this page is not HTTPS.";
  }

  if (reason === "permission-denied") {
    return "Motion permission was denied.";
  }

  if (reason === "permission-error") {
    return "Motion permission could not be requested.";
  }

  return "This browser does not support orientation events.";
}
