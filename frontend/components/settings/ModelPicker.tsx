import { useEffect, useMemo, useState } from 'react';
import { useModels } from '@/hooks/SharedModuleHooks/useModels';
import type { ModelInfo } from '@/api/models';

type ModelPickerProps = {
  /** Which catalogue to show. 'image' narrows to models that OUTPUT images —
   *  what `generate_image` needs — and hides the tool/vision filters, which are
   *  meaningless for a model that only draws. */
  /** Which catalogue to show. The three never mix, because picking one for
   *  another's job is always a configuration error: Claude cannot draw, an
   *  image model cannot reason, and a speech model does neither. */
  kind?: 'text' | 'image' | 'speech';
  /** Currently-selected model id ('' = none). */
  value: string;
  onSelect: (modelId: string) => void;
  /** Label for the "no explicit choice" row (e.g. "Use global default"). Omitted
   *  = no such row (the global-default picker itself has no fallback). */
  inheritLabel?: string;
};

const fmtPrice = (p: number | null): string =>
  p === null ? '—' : p === 0 ? 'free' : p < 0.01 ? `$${p.toFixed(4)}` : `$${p.toFixed(2)}`;

const fmtCtx = (c: number | null): string =>
  c === null ? '' : c >= 1000 ? `${Math.round(c / 1000)}k ctx` : `${c} ctx`;

type PriceTier = 'any' | 'free' | 'lt1' | 'lt10' | 'gte10';

/** Whether a model's prompt price falls in the chosen tier. */
function inPriceTier(m: ModelInfo, tier: PriceTier): boolean {
  if (tier === 'any') return true;
  const p = m.pricePromptPerM;
  if (tier === 'free') return p === 0;
  if (p === null) return false;
  if (tier === 'lt1') return p > 0 && p < 1;
  if (tier === 'lt10') return p >= 1 && p < 10;
  return p >= 10; // gte10
}

const selectCls =
  'cursor-pointer rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-1.5 py-1 font-mono text-[10px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]';

/**
 * Searchable, filterable, scrollable list of the live OpenRouter models — name,
 * provider, price per 1M (in/out), context, and tool/vision flags. Filters:
 * text search, provider/company, price tier (incl. free), and capability. Loads
 * the catalogue lazily. Theme-token styled; reused by the settings screen and the
 * per-agent model dialog. Fills its parent's height and scrolls internally.
 */
export default function ModelPicker({
  value,
  onSelect,
  inheritLabel,
  kind = 'text',
}: ModelPickerProps) {
  const { models, modelsLoaded, loadModels } = useModels();
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('all');
  const [tier, setTier] = useState<PriceTier>('any');
  const [capability, setCapability] = useState<'any' | 'tools' | 'vision'>('any');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadModels().catch((e) =>
      setError(e instanceof Error ? e.message : 'Could not load models.')
    );
  }, [loadModels]);

  // Distinct providers (companies), for the provider filter.
  const providers = useMemo(
    () => Array.from(new Set(models.map((m) => m.provider))).sort(),
    [models]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((m) => {
      if (q && !(m.name.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)))
        return false;
      // An image model is chosen for a different job than a reasoning model, so
      // the two catalogues never mix: picking Claude as an image model, or a
      // drawing model as an agent's brain, are both configuration errors.
      if (kind === 'image' && !m.image) return false;
      if (kind === 'speech' && !m.speech) return false;
      // A media model is excluded from the reasoning list only when it cannot
      // call tools — a few multimodal models genuinely do both, and hiding them
      // from the list they qualify for would be wrong.
      if (kind === 'text' && (m.image || m.speech) && !m.tools) return false;
      if (provider !== 'all' && m.provider !== provider) return false;
      if (!inPriceTier(m, tier)) return false;
      if (capability === 'tools' && !m.tools) return false;
      if (capability === 'vision' && !m.vision) return false;
      return true;
    });
  }, [models, query, provider, tier, capability, kind]);

  // A card in the responsive grid; highlighted when it's the selected model.
  // `fill` makes a card match its grid row's height. The inherit button below is
  // NOT in the grid, so h-full would resolve against the scroll container and
  // stretch it to the full viewport, pushing every model below the fold.
  const card = (selected: boolean, fill = true) =>
    `flex ${fill ? 'h-full ' : ''}w-full flex-col gap-1 rounded border px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)] ${
      selected
        ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10'
        : 'border-[var(--border-primary)] hover:border-[var(--content-tertiary)]'
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Search + filters (fixed at the top). */}
      <div className="flex shrink-0 flex-col gap-1.5">
        <input
          className="w-full rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[12px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
          placeholder="Search models…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <select className={selectCls} value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Company">
            <option value="all">All companies</option>
            {providers.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select className={selectCls} value={tier} onChange={(e) => setTier(e.target.value as PriceTier)} aria-label="Price">
            <option value="any">Any price</option>
            <option value="free">Free</option>
            <option value="lt1">&lt; $1/M</option>
            <option value="lt10">$1–10/M</option>
            <option value="gte10">≥ $10/M</option>
          </select>
          <select
            className={selectCls}
            value={capability}
            onChange={(e) => setCapability(e.target.value as 'any' | 'tools' | 'vision')}
            aria-label="Capability"
            hidden={kind !== 'text'}
          >
            <option value="any">Any capability</option>
            <option value="tools">Tools</option>
            <option value="vision">Vision</option>
          </select>
          <span className="ml-auto font-mono text-[9px] text-[var(--content-tertiary)]">
            {modelsLoaded ? `${filtered.length} of ${models.length}` : ''}
          </span>
        </div>
      </div>

      {error && (
        <p role="alert" className="shrink-0 font-mono text-[10px] text-[var(--semantic-error)]">
          {error}
        </p>
      )}

      {/* The scrolling results as a responsive card GRID (takes the remaining
          height). Columns fill to whatever the panel width allows. */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {inheritLabel && (
          <button
            type="button"
            onClick={() => onSelect('')}
            className={`${card(value === '', false)} mb-2`}
          >
            <span className="font-mono text-[12px] text-[var(--content-primary)]">
              {inheritLabel}
            </span>
          </button>
        )}

        {!modelsLoaded ? (
          <p className="px-1 py-2 font-mono text-[11px] text-[var(--content-tertiary)]">
            loading models…
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-1 py-2 font-mono text-[11px] text-[var(--content-tertiary)]">
            no models match these filters.
          </p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
            {filtered.map((m: ModelInfo) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onSelect(m.id)}
                  className={card(value === m.id)}
                  title={m.slug}
                >
                  <span className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 break-words font-mono text-[12px] leading-tight text-[var(--content-primary)]">
                      {m.name}
                    </span>
                    {value === m.id && (
                      <span className="shrink-0 font-mono text-[10px] text-[var(--accent-primary)]">
                        ✓
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--content-tertiary)]">
                    {m.provider}
                  </span>
                  <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[9.5px] text-[var(--content-tertiary)]">
                    <span>in {fmtPrice(m.pricePromptPerM)}/M</span>
                    <span>out {fmtPrice(m.priceCompletionPerM)}/M</span>
                    {m.context !== null && <span>{fmtCtx(m.context)}</span>}
                    {/* A MISSING "tools" badge is easy to miss, and picking such a
                        model for a seat that holds tools fails the run with a raw
                        404 from the provider. State the negative instead. */}
                    {kind === 'image' ? (
                      <span className="text-[var(--accent-secondary)]">image</span>
                    ) : kind === 'speech' ? (
                      <span className="text-[var(--accent-secondary)]">speech</span>
                    ) : m.tools ? (
                      <span className="text-[var(--accent-secondary)]">tools</span>
                    ) : (
                      <span className="text-[var(--semantic-error)]">no tools</span>
                    )}
                    {m.vision && <span className="text-[var(--accent-secondary)]">vision</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
