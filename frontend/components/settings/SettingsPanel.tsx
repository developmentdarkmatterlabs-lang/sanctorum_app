import { useEffect, useState } from "react";
import { useModels } from "@/hooks/SharedModuleHooks/useModels";
import type { KeyStatus } from "@/api/models";
import ModelPicker from "./ModelPicker";
import AnnounceSettings from "./AnnounceSettings";
import { Chip } from "@/components/ui";
import type { WebMode } from "@/api/models";
import type { AnnounceMode, VoiceOption } from "@/api/notify";

type SettingsPanelProps = {
  open: boolean;
  onClose: () => void;
  /** Announcement state, owned by OfficeModule (it holds the threads the
   *  announcer watches) and rendered here. */
  announce: {
    mode: AnnounceMode;
    setMode: (mode: AnnounceMode) => void;
    voiceUri: string;
    setVoiceUri: (uri: string) => void;
    voices: VoiceOption[];
    speechSupported: boolean;
    preview: (mode: AnnounceMode, voiceUri: string) => void;
  };
};

type KeyName = "openrouterKey" | "serperKey" | "replicateKey";

const labelSm =
  "font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--content-tertiary)]";

/** One numeric limit field. Commits on blur or Enter, so typing intermediate
 *  values ("1" on the way to "12") doesn't fire a save per keystroke. */
function LimitField({
  label,
  hint,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number | undefined;
  min: number;
  max?: number;
  step?: number;
  onCommit: (n: number) => Promise<unknown>;
}) {
  // `null` = not editing, so the field SHOWS the stored value. Typing sets a
  // draft; committing clears it and the stored value takes over again. Deriving
  // it this way (rather than syncing state in an effect) means a value clamped
  // by the server appears immediately, with no cascading render.
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = draft ?? (value === undefined ? "" : String(value));

  const commit = async () => {
    const n = Number(shown);
    if (!Number.isFinite(n) || n === value) {
      setDraft(null);
      return;
    }
    setBusy(true);
    try {
      await onCommit(n);
    } finally {
      setBusy(false);
      setDraft(null); // fall back to the stored (clamped) value
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step ?? 1}
        value={shown}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
        }}
        className="rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[12px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
      />
      <span className="font-mono text-[9.5px] leading-relaxed text-[var(--content-tertiary)]">
        {hint}
      </span>
    </div>
  );
}

/** One provider-key row: shows the masked status if set, an input to enter a new
 *  key (never shows the stored raw value), and a clear action. */
function ProviderKeyField({
  label,
  status,
  onSave,
}: {
  label: string;
  status: KeyStatus | undefined;
  onSave: (value: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (v: string) => {
    setBusy(true);
    try {
      await onSave(v);
      setValue("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
        {label}
        {status?.set ? (
          <span className="text-[var(--accent-primary)]">
            set {status.hint}
          </span>
        ) : (
          <span className="text-[var(--content-tertiary)]">not set</span>
        )}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          placeholder={
            status?.set ? "Enter a new key to replace…" : "Paste key…"
          }
          onChange={(e) => setValue(e.target.value)}
          className="min-w-0 flex-1 rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[12px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
        />
        <button
          type="button"
          onClick={() => void save(value.trim())}
          disabled={busy || !value.trim()}
          className="shrink-0 cursor-pointer rounded border border-[var(--accent-primary)] px-2.5 py-1.5 font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "…" : "save"}
        </button>
        {status?.set && (
          <button
            type="button"
            onClick={() => void save("")}
            disabled={busy}
            className="shrink-0 cursor-pointer rounded border border-[var(--border-primary)] px-2 py-1.5 font-mono text-[10px] text-[var(--content-tertiary)] hover:border-[var(--semantic-error)] hover:text-[var(--semantic-error)] disabled:opacity-40"
          >
            clear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * App settings — for now, the global default LLM model, chosen from the live
 * OpenRouter catalogue. Every agent without its own override uses this. Modal
 * overlay, theme-token styled, mirroring the FloorManager/TeamManager pattern.
 */
export default function SettingsPanel({
  open,
  onClose,
  announce,
}: SettingsPanelProps) {
  const {
    settings,
    setDefaultModel,
    setImageModel,
    setSpeechModel,
    setWebMode,
    setProviderKey,
    setLimits,
  } = useModels();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // One picker area, three catalogues. Tabs rather than stacked pickers,
  // because three full-height grids would triple the panel and bury all of them.
  //
  // Declared with the other hooks, ABOVE the early return: a hook after
  // `if (!open) return null` runs only while the panel is open, so React sees a
  // different hook count on each render and throws.
  const [picking, setPicking] = useState<"text" | "image" | "speech">("text");

  if (!open) return null;

  const current = settings?.defaultModel ?? "";
  const currentImage = settings?.imageModel ?? "";
  const currentSpeech = settings?.speechModel ?? "";
  const webMode: WebMode = settings?.webMode ?? "fetch";

  const choose = async (modelId: string) => {
    setSaving(true);
    setError(null);
    try {
      await setDefaultModel(modelId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const chooseImage = async (modelId: string) => {
    setSaving(true);
    setError(null);
    try {
      await setImageModel(modelId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const chooseWeb = async (mode: WebMode) => {
    setError(null);
    try {
      await setWebMode(mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  };

  const chooseSpeech = async (modelId: string) => {
    setSaving(true);
    setError(null);
    try {
      await setSpeechModel(modelId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const save = async (which: KeyName, value: string) => {
    setError(null);
    try {
      await setProviderKey(which, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save key.");
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[88vh] max-h-full w-[min(1100px,94vw)] max-w-full flex-col gap-3 overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--surface-secondary)] p-4 shadow-2xl">
        <div className="flex shrink-0 items-center">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto cursor-pointer rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
          >
            close
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="shrink-0 font-mono text-[10px] text-[var(--semantic-error)]"
          >
            {error}
          </p>
        )}

        {/* Two columns so the model picker is never pushed off-screen: the
            settings blocks scroll on the left, the catalogue owns the right. */}
        <div className="flex min-h-0 flex-1 gap-3 lg:flex-row flex-col">
          <div className="flex min-h-0 w-full shrink-0 flex-col gap-3 overflow-y-auto pr-1 lg:w-[420px]">
            {/* Which web tools agents get. Clearance still gates the browser; this
            only narrows what a qualified agent is offered. */}
            <div className="flex shrink-0 flex-col gap-2 rounded border border-[var(--border-primary)] p-2.5">
              <p className="font-mono text-[10.5px] leading-relaxed text-[var(--content-tertiary)]">
                {webMode === "fetch" &&
                  "Agents search, then read pages as text — no visible browser. Cheap and fast, but sites that render in JavaScript may come back empty."}
                {webMode === "browse" &&
                  "Agents search, then open pages in a real browser you can watch here. Works on any site and stays signed in between runs, at roughly 10x the cost of plain text."}
                {webMode === "both" &&
                  "The model picks per page. Flexible, but it leans on the cheap path — so the browser may stay closed."}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={labelSm}>Web access</span>
                {(["fetch", "browse", "both"] as WebMode[]).map((m) => (
                  <Chip
                    key={m}
                    active={webMode === m}
                    onClick={() => void chooseWeb(m)}
                  >
                    {m === "fetch"
                      ? "Text only"
                      : m === "browse"
                        ? "Browser"
                        : "Both"}
                  </Chip>
                ))}
              </div>
              <p className="font-mono text-[9.5px] text-[var(--content-tertiary)]">
                Requires clearance 5 for the browser. An agent can override this
                in its dossier.
              </p>
            </div>

            <AnnounceSettings
              mode={announce.mode}
              onMode={announce.setMode}
              voiceUri={announce.voiceUri}
              onVoice={announce.setVoiceUri}
              voices={announce.voices}
              speechSupported={announce.speechSupported}
              onPreview={announce.preview}
            />

            {/* API keys — masked; entered here instead of editing aiservice/.env. */}
            <div className="flex shrink-0 flex-col gap-2 rounded border border-[var(--border-primary)] p-2.5">
              <p className="font-mono text-[10.5px] leading-relaxed text-[var(--content-tertiary)]">
                Provider API keys. Used for runs, preferred over the
                service&apos;s env.{" "}
                <span className="text-[var(--content-secondary)]">
                  {settings?.keysEncrypted
                    ? "Encrypted at rest by your OS keychain."
                    : "Stored locally, unencrypted (no OS keychain available)."}
                </span>
              </p>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
                <ProviderKeyField
                  label="OpenRouter (LLM)"
                  status={settings?.openrouterKey}
                  onSave={(v) => save("openrouterKey", v)}
                />
                <ProviderKeyField
                  label="Serper (web search)"
                  status={settings?.serperKey}
                  onSave={(v) => save("serperKey", v)}
                />
                {/* Replicate — HIDDEN, not removed.
                Images now go through OpenRouter (`generate_image` dispatches to
                the configured image model), so this key buys nothing today and a
                field that does nothing is worse than no field.

                Everything behind it is intact: the AppSettings column, the
                settingsService passthrough, `providerKeys.replicate` on the
                RunSpec, and `spec.replicate_key()` on the Python side. Restore
                this block if a tool ever needs Replicate directly — video
                generation is the obvious candidate, since OpenRouter has none.
            <ProviderKeyField
              label="Replicate"
              status={settings?.replicateKey}
              onSave={(v) => save('replicateKey', v)}
            /> */}
              </div>
            </div>

            {/* Delegation limits — raise them if you have the budget. */}
            <div className="flex shrink-0 flex-col gap-2 rounded border border-[var(--border-primary)] p-2.5">
              <p className="font-mono text-[10.5px] leading-relaxed text-[var(--content-tertiary)]">
                Delegation limits. A team leader can hand work to its reports;
                these bound how far that can go.{" "}
                <span className="text-[var(--content-secondary)]">
                  Applied when a task starts, so changing them never disturbs
                  work already running.
                </span>
              </p>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
                <LimitField
                  label="Depth"
                  hint="How many levels deep delegation may go. 1 = no delegation. Max 10."
                  value={settings?.maxDelegationDepth}
                  min={1}
                  max={10}
                  onCommit={(n) => setLimits({ maxDelegationDepth: n })}
                />
                <LimitField
                  label="Runs per task"
                  hint="Total agent runs one task may spawn. 0 = unlimited."
                  value={settings?.maxRunsPerTree}
                  min={0}
                  onCommit={(n) => setLimits({ maxRunsPerTree: n })}
                />
                <LimitField
                  label="Cost ceiling (USD)"
                  hint="Stops starting NEW work once a task has spent this. 0 = unlimited. Checked between runs, so one run can overshoot."
                  value={settings?.maxCostPerTree}
                  min={0}
                  step={0.5}
                  onCommit={(n) => setLimits({ maxCostPerTree: n })}
                />
              </div>
            </div>
          </div>

          {/* The model catalogue — its own column, always visible. */}
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex shrink-0 items-center gap-1.5">
              {(["text", "image", "speech"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPicking(k)}
                  className={`cursor-pointer rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                    picking === k
                      ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]"
                      : "border-[var(--border-primary)] text-[var(--content-tertiary)] hover:text-[var(--content-secondary)]"
                  }`}
                >
                  {k === "text"
                    ? "Default model"
                    : k === "image"
                      ? "Image model"
                      : "Speech model"}
                </button>
              ))}
              {saving && (
                <span className="font-mono text-[10px] text-[var(--accent-primary)]">
                  saving…
                </span>
              )}
            </div>

            <p className="shrink-0 font-mono text-[10.5px] leading-relaxed text-[var(--content-tertiary)]">
              {picking === "text" ? (
                <>
                  What every agent REASONS with unless it has its own override.
                  Must support tool calling.{" "}
                  <span className="text-[var(--content-secondary)]">
                    Current: {current || "AI service default"}
                  </span>
                </>
              ) : picking === "image" ? (
                <>
                  What every agent DRAWS with when it calls{" "}
                  <span className="text-[var(--content-secondary)]">
                    generate_image
                  </span>
                  , unless it has its own override. A separate choice: these
                  models produce pictures and usually cannot call tools.{" "}
                  <span className="text-[var(--content-secondary)]">
                    Current: {currentImage || "AI service default"}
                  </span>
                </>
              ) : (
                <>
                  What every agent SPEAKS with when it calls{" "}
                  <span className="text-[var(--content-secondary)]">
                    generate_speech
                  </span>
                  , unless it has its own override. Unset by default: there is
                  no obvious choice to guess, so the tool refuses until one is
                  picked.{" "}
                  <span className="text-[var(--content-secondary)]">
                    Current:{" "}
                    {currentSpeech || "none — generate_speech is unavailable"}
                  </span>
                </>
              )}
            </p>

            <div className="min-h-0 flex-1">
              {picking === "text" ? (
                <ModelPicker
                  value={current}
                  onSelect={(id) => void choose(id)}
                />
              ) : picking === "image" ? (
                <ModelPicker
                  kind="image"
                  value={currentImage}
                  onSelect={(id) => void chooseImage(id)}
                />
              ) : (
                <ModelPicker
                  kind="speech"
                  value={currentSpeech}
                  onSelect={(id) => void chooseSpeech(id)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
