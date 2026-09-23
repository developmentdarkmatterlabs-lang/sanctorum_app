/**
 * Announcements — a chime or a spoken line when an agent replies or finishes.
 *
 * Deliberately NOT the `generate_speech` tool. That costs money per call, takes
 * a round trip, and needs a key; a UI notification must be free, instant and
 * work offline. Both engines here are built into the platform: WebAudio for the
 * chime, and `speechSynthesis` — SAPI on Windows, AVSpeechSynthesizer on macOS
 * — for the voice, so there is no bundled asset and no native module.
 *
 * Like api/window.ts this is a sibling of client.ts rather than a call through
 * it: nothing crosses a process boundary, so routing it through `request` would
 * mean inventing an endpoint for something the backend has no opinion about.
 */

export type AnnounceMode = 'off' | 'chime' | 'voice';

/** A voice the platform offers. `uri` is the stable handle to store. */
export type VoiceOption = { uri: string; name: string; lang: string };

const CHIME_MS = 160;

let audioContext: AudioContext | null = null;

/** Lazily created: constructing one before a user gesture leaves it suspended. */
function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioContext ??= new Ctor();
    return audioContext;
  } catch {
    return null;
  }
}

/** Two soft sine tones. Synthesised rather than shipped so there is no asset to
 *  package, and nothing to go missing from an asar. */
export function chime(): void {
  const ctx = context();
  if (!ctx) return;
  // A context created before any click starts suspended; resuming is a no-op
  // once it is running.
  void ctx.resume?.();

  const now = ctx.currentTime;
  [880, 1320].forEach((hz, i) => {
    const at = now + i * (CHIME_MS / 1000) * 0.6;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    // Fade out rather than stopping abruptly, which clicks.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.08, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + CHIME_MS / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + CHIME_MS / 1000);
  });
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * The platform's voices.
 *
 * Chrome and Electron populate the list ASYNCHRONOUSLY, so a first call often
 * returns [] and only `voiceschanged` says otherwise. Callers pass `onReady` to
 * be told once, rather than polling.
 */
export function voices(onReady?: (list: VoiceOption[]) => void): VoiceOption[] {
  if (!speechSupported()) return [];

  const read = (): VoiceOption[] =>
    window.speechSynthesis
      .getVoices()
      .map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang }));

  const now = read();
  if (onReady && now.length === 0) {
    const handler = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      onReady(read());
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler);
  }
  return now;
}

/** Speak `text`, cancelling anything already queued so announcements never
 *  stack up behind each other. */
export function speak(text: string, voiceUri = ''): void {
  if (!speechSupported() || !text.trim()) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (voiceUri) {
      const match = window.speechSynthesis.getVoices().find((v) => v.voiceURI === voiceUri);
      if (match) utterance.voice = match;
    }
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  } catch {
    // A speech engine that refuses must never break the UI that triggered it.
  }
}

/** Stop anything currently speaking. */
export function silence(): void {
  if (speechSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* nothing to stop */
    }
  }
}
