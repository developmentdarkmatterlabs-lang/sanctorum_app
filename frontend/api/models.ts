import { get, patch } from './client';

/** 'fetch' is cheap text; 'browse' is a real browser you can watch;
 *  'both' lets the model choose. Narrows what clearance already allows. */
export type WebMode = 'fetch' | 'browse' | 'both';

/** One model in the live OpenRouter catalogue, as served by the backend proxy. */
export type ModelInfo = {
  id: string; // "openrouter/anthropic/claude-3.7-sonnet"
  slug: string; // "anthropic/claude-3.7-sonnet"
  name: string;
  provider: string;
  context: number | null;
  pricePromptPerM: number | null;
  priceCompletionPerM: number | null;
  tools: boolean;
  vision: boolean;
  /** True when the model OUTPUTS images — what `generate_image` needs.
   *  Distinct from `vision`, which is about what it can READ. */
  image: boolean;
  /** True when the model OUTPUTS audio — what `generate_speech` needs. */
  speech: boolean;
  /** True when the model ACCEPTS audio (a transcriber). No tool uses this yet;
   *  it is here so the picker can tell a transcriber from a speaker. */
  audioInput: boolean;
};

/** A stored provider key, as the server reports it — masked, never the raw value. */
export type KeyStatus = {
  set: boolean;
  /** Last 4 chars for recognition ("…a1b2"), or empty when unset. */
  hint: string;
};

export type AppSettings = {
  theme: string;
  fontSize: number;
  fontFamily: string;
  defaultModel: string;
  /** Global image model for `generate_image`; '' = the service's env default. */
  imageModel: string;
  /** Global speech model for `generate_speech`; '' = none configured, and the
   *  tool refuses rather than guessing a provider. */
  speechModel: string;
  /** Which web tools every agent is offered unless it overrides. */
  webMode: WebMode;
  /** Provider keys — masked status only, never the raw key. */
  openrouterKey: KeyStatus;
  serperKey: KeyStatus;
  replicateKey: KeyStatus;
  /** Phase 4 — delegation limits. Depth is clamped 1-10 server-side (no
   *  "unlimited": it is the guard against a delegation cycle). Runs and cost
   *  take 0 = unlimited. */
  maxDelegationDepth: number;
  maxRunsPerTree: number;
  maxCostPerTree: number;
  /** Whether stored keys are OS-encrypted. False in a browser. */
  keysEncrypted: boolean;
};

/** What the client may WRITE: non-key fields plus RAW keys ('' clears one). */
export type SettingsWrite = {
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  defaultModel?: string;
  imageModel?: string;
  speechModel?: string;
  webMode?: WebMode;
  openrouterKey?: string;
  serperKey?: string;
  replicateKey?: string;
  maxDelegationDepth?: number;
  maxRunsPerTree?: number;
  maxCostPerTree?: number;
};

/** The live model list (backend caches it; `refresh` bypasses the cache). */
export const fetchModels = (refresh = false) =>
  get<ModelInfo[]>(`/api/settings/models${refresh ? '?refresh=1' : ''}`);

export const fetchSettings = () => get<AppSettings>('/api/settings');

/** Patch settings — default model, or a raw provider key. Returns masked settings. */
export const updateSettings = (patchData: SettingsWrite) =>
  patch<AppSettings>('/api/settings', patchData);
