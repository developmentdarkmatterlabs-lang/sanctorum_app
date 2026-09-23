import { Play } from 'lucide-react';
import { fieldClass, labelClass } from '@/components/forms/DossierFields';
import { Chip } from '@/components/ui';
import type { AnnounceMode, VoiceOption } from '@/api/notify';

type AnnounceSettingsProps = {
  mode: AnnounceMode;
  onMode: (mode: AnnounceMode) => void;
  voiceUri: string;
  onVoice: (uri: string) => void;
  voices: VoiceOption[];
  speechSupported: boolean;
  onPreview: (mode: AnnounceMode, voiceUri: string) => void;
};

const MODES: { value: AnnounceMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'chime', label: 'Chime' },
  { value: 'voice', label: 'Voice' },
];

/** Whether this machine makes a sound when an agent replies or finishes. */
export default function AnnounceSettings({
  mode,
  onMode,
  voiceUri,
  onVoice,
  voices,
  speechSupported,
  onPreview,
}: AnnounceSettingsProps) {
  return (
    <div className="flex shrink-0 flex-col gap-2 rounded border border-[var(--border-primary)] p-2.5">
      <p className="font-mono text-[10.5px] leading-relaxed text-[var(--content-tertiary)]">
        A sound when an agent replies or finishes. Uses your system&apos;s own voice — free,
        instant and offline. Stored per machine, not synced.
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={labelClass}>Announce</span>
        {MODES.map((m) => (
          <Chip
            key={m.value}
            active={mode === m.value}
            onClick={() => onMode(m.value)}
            disabled={m.value === 'voice' && !speechSupported}
            title={
              m.value === 'voice' && !speechSupported
                ? 'No speech engine available on this system'
                : undefined
            }
          >
            {m.label}
          </Chip>
        ))}

        <button
          type="button"
          onClick={() => onPreview(mode, voiceUri)}
          disabled={mode === 'off'}
          aria-label="Play a sample"
          title="Play a sample"
          className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] transition-colors hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] disabled:cursor-default disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
        >
          <Play size={11} strokeWidth={1.75} aria-hidden="true" />
          Test
        </button>
      </div>

      {mode === 'voice' && speechSupported && (
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Voice</span>
          <select
            className={fieldClass}
            value={voiceUri}
            onChange={(e) => onVoice(e.target.value)}
          >
            {/* Blank means the platform default, which is the one the user has
                already configured for their system. */}
            <option value="">System default</option>
            {voices.map((v) => (
              <option key={v.uri} value={v.uri}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
