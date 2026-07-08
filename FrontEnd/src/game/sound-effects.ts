/**
 * Game SFX via the Web Audio API. Whistle and goal horn are synthesized;
 * the cheer is a recorded crowd clip trimmed to its first couple of seconds.
 */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  const AudioContextClass = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextClass) {
    return null;
  }

  audioContext ??= new AudioContextClass();

  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }

  return audioContext;
}

function unlockAudioContext(): void {
  const context = getAudioContext();

  if (context) {
    void loadCheerBuffer(context);
  }
}

if (typeof window !== "undefined") {
  const unlockEvents = ["pointerdown", "keydown", "touchstart"] as const;

  const handleFirstInteraction = (): void => {
    unlockAudioContext();
    unlockEvents.forEach((eventName) => window.removeEventListener(eventName, handleFirstInteraction));
  };

  unlockEvents.forEach((eventName) => window.addEventListener(eventName, handleFirstInteraction));
}

function playTone(
  context: AudioContext,
  frequency: number,
  startTime: number,
  duration: number,
  type: OscillatorType,
  peakGain: number
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.05);
}

/** Used for both the initial kickoff and the restart after a goal. */
export function playWhistle(): void {
  const context = getAudioContext();

  if (!context) {
    return;
  }

  const now = context.currentTime;
  const duration = 0.55;
  const stopAt = now + duration + 0.05;

  
  const carrier = context.createOscillator();
  const vibrato = context.createOscillator();
  const vibratoDepth = context.createGain();
  const toneGain = context.createGain();

  carrier.type = "triangle";
  carrier.frequency.setValueAtTime(3000, now);

  vibrato.type = "sine";
  vibrato.frequency.setValueAtTime(28, now);
  vibratoDepth.gain.setValueAtTime(130, now);
  vibrato.connect(vibratoDepth);
  vibratoDepth.connect(carrier.frequency);

  toneGain.gain.setValueAtTime(0, now);
  toneGain.gain.linearRampToValueAtTime(0.3, now + 0.015);
  toneGain.gain.setValueAtTime(0.3, now + duration * 0.7);
  toneGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  carrier.connect(toneGain);
  toneGain.connect(context.destination);

 
  const noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);

  for (let i = 0; i < noiseData.length; i += 1) {
    noiseData[i] = Math.random() * 2 - 1;
  }

  const noise = context.createBufferSource();
  const noiseFilter = context.createBiquadFilter();
  const noiseGain = context.createGain();

  noise.buffer = noiseBuffer;
  noiseFilter.type = "highpass";
  noiseFilter.frequency.setValueAtTime(2200, now);
  noiseGain.gain.setValueAtTime(0, now);
  noiseGain.gain.linearRampToValueAtTime(0.05, now + 0.015);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(context.destination);

  carrier.start(now);
  carrier.stop(stopAt);
  vibrato.start(now);
  vibrato.stop(stopAt);
  noise.start(now);
  noise.stop(stopAt);
}

export function playGoalHorn(): void {
  const context = getAudioContext();

  if (!context) {
    return;
  }

  const now = context.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5];

  notes.forEach((frequency, index) => {
    playTone(context, frequency, now + index * 0.09, 0.35, "sawtooth", 0.22);
  });
}

const CHEER_SOUND_URL = "/sounds/crowd-cheer.mp3";
const CHEER_CLIP_DURATION = 2;
const CHEER_FADE_OUT_DURATION = 0.15;

let cheerBufferPromise: Promise<AudioBuffer | null> | null = null;

function loadCheerBuffer(context: AudioContext): Promise<AudioBuffer | null> {
  cheerBufferPromise ??= fetch(CHEER_SOUND_URL)
    .then((response) => response.arrayBuffer())
    .then((data) => context.decodeAudioData(data))
    .catch(() => null);

  return cheerBufferPromise;
}

export function playCheer(): void {
  const context = getAudioContext();

  if (!context) {
    return;
  }

  void loadCheerBuffer(context).then((buffer) => {
    if (!buffer) {
      return;
    }

    const now = context.currentTime;
    const clipDuration = Math.min(CHEER_CLIP_DURATION, buffer.duration);
    const fadeOutStart = now + Math.max(0, clipDuration - CHEER_FADE_OUT_DURATION);

    const source = context.createBufferSource();
    const gain = context.createGain();

    source.buffer = buffer;
    gain.gain.setValueAtTime(1, now);
    gain.gain.setValueAtTime(1, fadeOutStart);
    gain.gain.linearRampToValueAtTime(0, now + clipDuration);

    source.connect(gain);
    gain.connect(context.destination);
    source.start(now, 0, clipDuration);
  });
}
