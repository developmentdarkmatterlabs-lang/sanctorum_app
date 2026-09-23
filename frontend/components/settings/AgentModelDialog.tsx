import { useEffect, useState } from 'react';
import ModelPicker from './ModelPicker';

type AgentModelDialogProps = {
  /** The agent whose model is being chosen; null = closed. */
  agent: {
    key: string;
    name: string;
    model: string | null;
    imageModel: string | null;
    speechModel: string | null;
  } | null;
  onClose: () => void;
  /** Persist the chosen model ('' clears the override → global default). The
   *  `field` says WHICH cascade is being set: what the agent reasons with, or
   *  what it draws with. */
  onChoose: (
    agentKey: string,
    modelId: string,
    field: 'model' | 'imageModel' | 'speechModel'
  ) => Promise<unknown>;
};

/**
 * Popup for choosing ONE agent's model override — same modal shape as the global
 * settings screen, with the full filterable/scrollable ModelPicker. Reused so the
 * per-agent and global pickers look and behave identically.
 */
export default function AgentModelDialog({ agent, onClose, onChoose }: AgentModelDialogProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same tab pattern as the settings panel: three catalogues, one picker area.
  const [picking, setPicking] = useState<'model' | 'imageModel' | 'speechModel'>('model');

  useEffect(() => {
    if (!agent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agent, onClose]);

  if (!agent) return null;

  const choose = async (modelId: string) => {
    setSaving(true);
    setError(null);
    try {
      await onChoose(agent.key, modelId, picking);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set model.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[560px] max-h-full w-[460px] max-w-full flex-col gap-3 overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--surface-secondary)] p-4 shadow-2xl">
        <div className="flex items-center">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
            {agent.name} — model
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto cursor-pointer rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
          >
            close
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {(['model', 'imageModel', 'speechModel'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setPicking(k)}
              className={`cursor-pointer rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                picking === k
                  ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                  : 'border-[var(--border-primary)] text-[var(--content-tertiary)] hover:text-[var(--content-secondary)]'
              }`}
            >
              {k === 'model' ? 'Reasoning' : k === 'imageModel' ? 'Image' : 'Speech'}
            </button>
          ))}
          {saving && (
            <span className="font-mono text-[10px] text-[var(--accent-primary)]">saving…</span>
          )}
        </div>

        <p className="shrink-0 font-mono text-[10.5px] leading-relaxed text-[var(--content-tertiary)]">
          Overrides just this agent&apos;s runs. Pick{' '}
          <span className="text-[var(--content-secondary)]">Use global default</span> to
          clear the override.{' '}
          {picking === 'model' ? (
            <>
              What it reasons with — must support tool calling.{' '}
              <span className="text-[var(--content-secondary)]">
                Current: {agent.model || 'global default'}
              </span>
            </>
          ) : picking === 'imageModel' ? (
            <>
              What it draws with when it calls{' '}
              <span className="text-[var(--content-secondary)]">generate_image</span>.{' '}
              <span className="text-[var(--content-secondary)]">
                Current: {agent.imageModel || 'global default'}
              </span>
            </>
          ) : (
            <>
              What it speaks with when it calls{' '}
              <span className="text-[var(--content-secondary)]">generate_speech</span>.{' '}
              <span className="text-[var(--content-secondary)]">
                Current: {agent.speechModel || 'global default'}
              </span>
            </>
          )}
        </p>

        {error && (
          <p role="alert" className="shrink-0 font-mono text-[10px] text-[var(--semantic-error)]">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1">
          <ModelPicker
            kind={
              picking === 'imageModel' ? 'image' : picking === 'speechModel' ? 'speech' : 'text'
            }
            value={
              (picking === 'model'
                ? agent.model
                : picking === 'imageModel'
                  ? agent.imageModel
                  : agent.speechModel) ?? ''
            }
            onSelect={(id) => void choose(id)}
            inheritLabel="Use global default"
          />
        </div>
      </div>
    </div>
  );
}
