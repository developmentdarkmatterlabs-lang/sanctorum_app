import { useCallback, useEffect, useRef, useState } from 'react';
import { notifyService } from '@/services/notifyService';
import type { AnnounceMode, VoiceOption } from '@/api/notify';
import type { Thread } from '@/store/inboxStore';

/**
 * Announces two things: an agent replying, and an agent finishing.
 *
 * WHY IT WATCHES THREADS RATHER THAN LISTENING FOR AN EVENT. Nothing pushes to
 * the browser — useInbox polls, and a reply is simply a thread whose `unread`
 * went up. So the trigger is a DIFF between polls, held in a ref: comparing
 * against the previous render's props would re-fire on every unrelated render.
 *
 * `activeRunId` going null is the other edge — a run that was in flight no
 * longer is, which is "finished" without needing a completion event.
 */

type Snapshot = { unread: number; active: boolean };

export function useAnnounce(threads: Thread[], nameOf: (agentKey: string | null) => string) {
  const previous = useRef<Map<string, Snapshot> | null>(null);
  // Lazy initialisers, not an effect: the stored preference is known on the
  // first render, so seeding it later would render once with the wrong value.
  const [mode, setModeState] = useState<AnnounceMode>(() => notifyService.mode());
  const [voiceUri, setVoiceState] = useState(() => notifyService.voiceUri());
  // Read once on the first render; the effect below only handles the case where
  // the platform had none ready yet.
  const [voiceList, setVoiceList] = useState<VoiceOption[]>(() =>
    notifyService.voicesAvailable()
  );

  // Chrome and Electron populate the voice list asynchronously, so an empty
  // first read is normal — subscribe for the late arrival.
  useEffect(() => {
    if (voiceList.length) return;
    notifyService.voicesAvailable((list) => setVoiceList(list));
    // Intentionally once: `voicesAvailable` registers a one-shot listener, and
    // re-running on every change would stack them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const now = new Map<string, Snapshot>(
      threads.map((t) => [t.id, { unread: t.unread, active: Boolean(t.activeRunId) }])
    );

    // The first poll establishes a baseline; announcing from it would fire for
    // every thread that was already unread when the window opened.
    if (previous.current === null) {
      previous.current = now;
      return;
    }

    if (notifyService.settled()) {
      for (const thread of threads) {
        const before = previous.current.get(thread.id);
        if (!before) continue;
        const name = nameOf(thread.agentKey);

        if (thread.unread > before.unread) {
          notifyService.announce(notifyService.messagePhrase(name));
          break;
        }
        if (before.active && !thread.activeRunId) {
          notifyService.announce(notifyService.taskPhrase(name));
          break;
        }
      }
    }

    previous.current = now;
  }, [threads, nameOf]);

  const setMode = useCallback((next: AnnounceMode) => {
    notifyService.setMode(next);
    setModeState(next);
  }, []);

  const setVoiceUri = useCallback((uri: string) => {
    notifyService.setVoiceUri(uri);
    setVoiceState(uri);
  }, []);

  return {
    mode,
    setMode,
    voiceUri,
    setVoiceUri,
    voices: voiceList,
    speechSupported: notifyService.speechSupported(),
    preview: useCallback(
      (m: AnnounceMode, uri: string) => notifyService.preview(m, uri),
      []
    ),
  };
}
