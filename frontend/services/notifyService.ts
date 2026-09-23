import {
  chime,
  silence,
  speak,
  speechSupported,
  voices,
  type AnnounceMode,
  type VoiceOption,
} from '@/api/notify';

/**
 * Announcements: what to play, and whether to play it at all.
 *
 * WHY THE PREFERENCE IS LOCAL, NOT IN AppSettings. Every other setting is a
 * property of the ORG and belongs in the database — the default model is the
 * same wherever you open the app. Whether this machine makes noise is a property
 * of THIS machine: the same user on a laptop in a meeting and a desktop at home
 * wants different answers, and a synced value would be wrong in one of them.
 *
 * CHIME IS THE DEFAULT, not voice. A spoken line on every reply is charming for
 * an hour and irritating by the third day; a sound you can ignore is better
 * background than words you cannot.
 */

const KEY_MODE = 'sanctorum.announce.mode';
const KEY_VOICE = 'sanctorum.announce.voice';

/** Announcements are suppressed for this long after load, so a window opening
 *  onto ten unread threads does not fire ten notifications. */
const SETTLE_MS = 3000;

export class NotifyService {
  private readonly startedAt = Date.now();

  /** localStorage throws in some privacy modes; a preference is never worth an
   *  exception, so every access falls back to the default. */
  private read(key: string, fallback: string): string {
    try {
      return window.localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  private write(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* preference simply will not persist */
    }
  }

  mode(): AnnounceMode {
    const stored = this.read(KEY_MODE, 'chime');
    return stored === 'off' || stored === 'voice' ? stored : 'chime';
  }

  setMode(mode: AnnounceMode): void {
    this.write(KEY_MODE, mode);
    if (mode !== 'voice') silence();
  }

  voiceUri(): string {
    return this.read(KEY_VOICE, '');
  }

  setVoiceUri(uri: string): void {
    this.write(KEY_VOICE, uri);
  }

  voicesAvailable(onReady?: (list: VoiceOption[]) => void): VoiceOption[] {
    return voices(onReady);
  }

  speechSupported(): boolean {
    return speechSupported();
  }

  /** Play `text` in whichever way the user chose. Silent when off. */
  announce(text: string): void {
    const mode = this.mode();
    if (mode === 'off') return;
    if (mode === 'voice' && speechSupported()) {
      speak(text, this.voiceUri());
      return;
    }
    chime();
  }

  /** True once the app has been open long enough that an event is genuinely new
   *  rather than a leftover from before this window existed. */
  settled(): boolean {
    return Date.now() - this.startedAt > SETTLE_MS;
  }

  /** Both phrases in one place, so wording stays consistent. */
  messagePhrase(agentName: string): string {
    return `${agentName} sent a message`;
  }

  taskPhrase(agentName: string): string {
    return `${agentName} finished`;
  }

  /** Play a sample so the user hears their choice before leaving settings. */
  preview(mode: AnnounceMode, voiceUri: string): void {
    if (mode === 'off') return;
    if (mode === 'voice' && speechSupported()) {
      speak('Alden sent a message', voiceUri);
      return;
    }
    chime();
  }
}

export const notifyService = new NotifyService();
