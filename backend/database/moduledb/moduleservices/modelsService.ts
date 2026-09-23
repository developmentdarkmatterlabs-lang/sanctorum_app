// Live OpenRouter model catalogue, proxied so the frontend calls the backend
// like everything else and the list is always current (no hardcoded slugs).
// Cached briefly to avoid hammering OpenRouter on every settings open.

export type ModelInfo = {
  /** The id to use as a model string, already prefixed "openrouter/...". */
  id: string;
  /** The raw OpenRouter id (e.g. "anthropic/claude-3.7-sonnet"). */
  slug: string;
  name: string;
  provider: string;
  /** Context window in tokens, or null if unknown. */
  context: number | null;
  /** USD price per 1M prompt tokens, or null. */
  pricePromptPerM: number | null;
  /** USD price per 1M completion tokens, or null. */
  priceCompletionPerM: number | null;
  /** Capability hints parsed from OpenRouter metadata. */
  tools: boolean;
  vision: boolean;
  /** True when the model OUTPUTS images — what `generate_image` needs. Distinct
   *  from `vision`, which is about what it can READ. */
  image: boolean;
  /** True when the model OUTPUTS sound — what `generate_speech` needs. Again
   *  distinct from reading: a model that TRANSCRIBES takes audio in, which is
   *  `audioInput` below, and is a different capability entirely.
   *
   *  TWO MODALITY NAMES MEAN THIS. OpenRouter labels the dedicated
   *  text-to-speech models 'speech' (18 of them: fish-audio, deepgram, kokoro,
   *  minimax…) and the conversational multimodal ones 'audio' (4: gpt-audio,
   *  lyria). Checking only one name finds only that group — which is how this
   *  first shipped showing 4 models instead of 22. */
  speech: boolean;
  /** True when the model ACCEPTS audio. Not used by a tool yet; surfaced so the
   *  picker can tell a transcriber from a speaker rather than lumping both
   *  under one "audio" badge. */
  audioInput: boolean;
};

type CacheEntry = { at: number; models: ModelInfo[] };
let cache: CacheEntry | null = null;
const TTL_MS = 5 * 60 * 1000; // 5 minutes

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Maps one raw OpenRouter model entry to our DTO. */
function toInfo(m: Record<string, unknown>): ModelInfo {
  const slug = String(m.id ?? '');
  const provider = slug.includes('/') ? slug.split('/')[0] : 'openrouter';
  const pricing = (m.pricing ?? {}) as Record<string, unknown>;
  // OpenRouter prices are per-token strings; ×1e6 for per-million.
  const prompt = num(pricing.prompt);
  const completion = num(pricing.completion);
  const arch = (m.architecture ?? {}) as Record<string, unknown>;
  const modalities = Array.isArray(arch.input_modalities)
    ? (arch.input_modalities as string[])
    : [];
  const outputs = Array.isArray(arch.output_modalities)
    ? (arch.output_modalities as string[])
    : [];
  const supported = Array.isArray(m.supported_parameters)
    ? (m.supported_parameters as string[])
    : [];
  return {
    id: `openrouter/${slug}`,
    slug,
    name: String(m.name ?? slug),
    provider,
    context: num(m.context_length),
    pricePromptPerM: prompt === null ? null : prompt * 1_000_000,
    priceCompletionPerM: completion === null ? null : completion * 1_000_000,
    tools: supported.includes('tools'),
    vision: modalities.includes('image'),
    image: outputs.includes('image'),
    speech: outputs.includes('audio') || outputs.includes('speech'),
    audioInput: modalities.includes('audio'),
  };
}

/**
 * Fetches the live model list from OpenRouter (cached). Throws if OpenRouter is
 * unreachable so the route can surface a clear error.
 */
export async function listModels(force = false): Promise<ModelInfo[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) {
    return cache.models;
  }
  // FOUR requests, because the default catalogue OMITS models whose output is
  // not text: one whose output_modalities is exactly ['image'] is absent from
  // /models and appears only under ?output_modalities=image. Reading one list
  // would offer 11 image models instead of 54 and hide the dedicated generators
  // entirely.
  //
  // Sound needs TWO of those requests, because OpenRouter uses two different
  // modality names for it and they do not overlap:
  //   output_modalities=audio   ->  4  conversational multimodal (gpt-audio, lyria)
  //   output_modalities=speech  -> 18  dedicated TTS (fish-audio, deepgram, kokoro…)
  // `?category=speech`, `=tts` and `=transcription` were all tried and return
  // nothing, so output_modalities is the only filter OpenRouter honours here.
  const [res, imgRes, audioRes, speechRes] = await Promise.all([
    fetch('https://openrouter.ai/api/v1/models', { headers: { Accept: 'application/json' } }),
    fetch('https://openrouter.ai/api/v1/models?output_modalities=image', {
      headers: { Accept: 'application/json' },
    }).catch(() => null),
    fetch('https://openrouter.ai/api/v1/models?output_modalities=audio', {
      headers: { Accept: 'application/json' },
    }).catch(() => null),
    // A SEPARATE request from 'audio' above, not a synonym for it: the two
    // filters return disjoint sets (4 and 18), and querying either alone hides
    // the other group entirely.
    fetch('https://openrouter.ai/api/v1/models?output_modalities=speech', {
      headers: { Accept: 'application/json' },
    }).catch(() => null),
  ]);
  if (!res.ok) {
    throw new Error(`OpenRouter models request failed (${res.status})`);
  }
  const body = (await res.json()) as { data?: Record<string, unknown>[] };
  const rows = [...(body.data ?? [])];

  // Merge the media catalogues in. A failure here is non-fatal: the text models
  // are the ones every run needs, and losing one of these degrades a filter
  // rather than breaking the app.
  const seen = new Set(rows.map((r) => String(r.id ?? '')));
  for (const extra of [imgRes, audioRes, speechRes]) {
    if (!extra?.ok) continue;
    try {
      const extraBody = (await extra.json()) as { data?: Record<string, unknown>[] };
      for (const row of extraBody.data ?? []) {
        const id = String(row.id ?? '');
        if (!seen.has(id)) {
          seen.add(id);
          rows.push(row);
        }
      }
    } catch {
      // Keep what we have; the affected filter simply shows fewer models.
    }
  }

  const models = rows.map(toInfo).sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), models };
  return models;
}
