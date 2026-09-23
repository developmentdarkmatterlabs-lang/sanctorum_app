import { prisma } from '../../db';
import { clampLimits } from './runTreeService';
import { isWebMode } from '../../../runtime/ToolPolicy';
import { decryptSecret, encryptSecret, keyHint, secretsAvailable } from '../../../utils/secrets';

// App-wide settings, persisted so the backend can read them when building runs
// (the global default model + provider API keys). Theme/font are also here for the
// settings screen.
//
// SECURITY: provider keys are ENCRYPTED AT REST by the OS (safeStorage — DPAPI on
// Windows, Keychain on macOS), via utils/secrets. Outside Electron there is no
// keyring, so they degrade to plaintext exactly as before. They are NEVER returned
// raw to the client — the read DTO masks them (…last4 + a hasKey flag). Only
// `updateSettings` accepts a raw key, and the raw value is read server-side
// (buildRunSpec) to pass into a run. Not logged.

/** A masked view of a stored key for the UI: whether one is set + a hint. */
export type KeyStatus = {
  set: boolean;
  /** Last 4 chars, for recognition (e.g. "…a1b2"). Empty when unset. */
  hint: string;
};

export type SettingsDTO = {
  theme: string;
  fontSize: number;
  fontFamily: string;
  /** Global default LLM model (OpenRouter id); '' = use the AI service's env. */
  defaultModel: string;
  imageModel: string;
  /** Global model for `generate_speech`; '' = use the AI service's env. */
  speechModel: string;
  /** 'fetch' | 'browse' | 'both' — which web tools every agent is offered. */
  webMode: string;
  // Masked key status — never the raw key.
  openrouterKey: KeyStatus;
  serperKey: KeyStatus;
  replicateKey: KeyStatus;
  // Phase 4 — delegation limits. Not secrets, so returned plainly.
  // depth is clamped 1-10 (no "unlimited": it is the cycle guard);
  // runs and cost take 0 = unlimited.
  maxDelegationDepth: number;
  maxRunsPerTree: number;
  maxCostPerTree: number;
  /** Whether stored keys are OS-encrypted. False outside Electron. */
  keysEncrypted: boolean;
};

/** Masked status for the UI. The hint is the PLAINTEXT's last 4, so it still
 *  reads as "…a1b2" once the stored value is ciphertext. */
const maskKey = async (raw: string): Promise<KeyStatus> =>
  raw ? { set: true, hint: await keyHint(raw) } : { set: false, hint: '' };

const toDTO = async (row: {
  theme: string;
  fontSize: number;
  fontFamily: string;
  defaultModel: string;
  imageModel: string;
  speechModel: string;
  webMode: string;
  openrouterKey: string;
  serperKey: string;
  replicateKey: string;
  maxDelegationDepth: number;
  maxRunsPerTree: number;
  maxCostPerTree: number;
}): Promise<SettingsDTO> => ({
  theme: row.theme,
  fontSize: row.fontSize,
  fontFamily: row.fontFamily,
  defaultModel: row.defaultModel,
  imageModel: row.imageModel,
  speechModel: row.speechModel,
  webMode: row.webMode,
  openrouterKey: await maskKey(row.openrouterKey),
  serperKey: await maskKey(row.serperKey),
  replicateKey: await maskKey(row.replicateKey),
  maxDelegationDepth: row.maxDelegationDepth,
  maxRunsPerTree: row.maxRunsPerTree,
  maxCostPerTree: row.maxCostPerTree,
  keysEncrypted: secretsAvailable(),
});

/** The single settings row, creating it with defaults on first read. */
export async function getSettings(): Promise<SettingsDTO> {
  const row = await prisma.appSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });
  return await toDTO(row);
}

/** The raw provider keys, read server-side only (to pass into a run). Never sent
 *  to the client. */
export async function getProviderKeys(): Promise<{
  openrouter: string;
  serper: string;
  replicate: string;
}> {
  const row = await prisma.appSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });
  return {
    openrouter: await decryptSecret(row.openrouterKey),
    serper: await decryptSecret(row.serperKey),
    replicate: await decryptSecret(row.replicateKey),
  };
}

/** What the update route accepts: non-key fields, plus RAW keys ('' clears one,
 *  undefined leaves it unchanged). */
export type SettingsPatch = {
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  defaultModel?: string;
  imageModel?: string;
  speechModel?: string;
  webMode?: string;
  openrouterKey?: string;
  serperKey?: string;
  replicateKey?: string;
  maxDelegationDepth?: number;
  maxRunsPerTree?: number;
  maxCostPerTree?: number;
};

/** Patch any subset of settings. Returns the masked DTO (no raw keys). */
export async function updateSettings(patch: SettingsPatch): Promise<SettingsDTO> {
  const row = await prisma.appSettings.upsert({
    where: { id: 'default' },
    update: {
      ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
      ...(patch.fontSize !== undefined ? { fontSize: patch.fontSize } : {}),
      ...(patch.fontFamily !== undefined ? { fontFamily: patch.fontFamily } : {}),
      ...(patch.defaultModel !== undefined ? { defaultModel: patch.defaultModel } : {}),
      ...(patch.imageModel !== undefined ? { imageModel: patch.imageModel } : {}),
      ...(patch.speechModel !== undefined ? { speechModel: patch.speechModel } : {}),
      ...(isWebMode(patch.webMode) ? { webMode: patch.webMode } : {}),
      ...(patch.openrouterKey !== undefined
        ? { openrouterKey: await encryptSecret(patch.openrouterKey.trim()) }
        : {}),
      ...(patch.serperKey !== undefined
        ? { serperKey: await encryptSecret(patch.serperKey.trim()) }
        : {}),
      ...(patch.replicateKey !== undefined
        ? { replicateKey: await encryptSecret(patch.replicateKey.trim()) }
        : {}),
      // Phase 4 — clamped in ONE place so a bad PATCH can't persist a negative,
      // a NaN, or a depth of 0 (which would disable the cycle guard).
      ...clampLimits({
        maxDelegationDepth: patch.maxDelegationDepth,
        maxRunsPerTree: patch.maxRunsPerTree,
        maxCostPerTree: patch.maxCostPerTree,
      }),
    },
    create: { id: 'default' },
  });
  return await toDTO(row);
}
