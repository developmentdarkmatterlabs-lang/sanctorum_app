import type { WebMode } from '@/api/models';
import {
  fetchModels,
  fetchSettings,
  updateSettings,
  type SettingsWrite,
} from '@/api/models';
import { useModelStore } from '@/store/modelStore';

/**
 * Model catalogue + settings. Follows Component -> Hook -> Service -> API,
 * patching the model store so pickers re-render. The global default model lives
 * in AppSettings (backend-persisted, since agents read it server-side).
 */
export class ModelService {
  /** Load the live model list into the store (once, unless forced). */
  async loadModels(refresh = false): Promise<void> {
    const { modelsLoaded } = useModelStore.getState();
    if (modelsLoaded && !refresh) return;
    useModelStore.getState().setModels(await fetchModels(refresh));
  }

  /** Load app settings (incl. the default model) into the store. */
  async loadSettings(): Promise<void> {
    useModelStore.getState().setSettings(await fetchSettings());
  }

  /** Set the global default model, patching the store on success. */
  async setDefaultModel(model: string): Promise<void> {
    const next = await updateSettings({ defaultModel: model });
    useModelStore.getState().setSettings(next);
  }

  /** Set the global IMAGE model, patching the store on success. A separate
   *  setting from the default model: that one reasons and must call tools, this
   *  one draws and usually cannot. */
  async setImageModel(model: string): Promise<void> {
    const next = await updateSettings({ imageModel: model });
    useModelStore.getState().setSettings(next);
  }

  /** Set the global SPEECH model, patching the store on success. A third
   *  setting beside the default and image models, separate for the same reason:
   *  a model that talks is rarely one that reasons or draws. */
  async setSpeechModel(model: string): Promise<void> {
    const next = await updateSettings({ speechModel: model });
    useModelStore.getState().setSettings(next);
  }

  /** Set the global web mode — which web tools agents are offered. */
  async setWebMode(mode: WebMode): Promise<void> {
    const next = await updateSettings({ webMode: mode });
    useModelStore.getState().setSettings(next);
  }

  /** Patch any settings subset (theme/font/default model/raw provider key). */
  async updateSettings(patch: SettingsWrite): Promise<void> {
    useModelStore.getState().setSettings(await updateSettings(patch));
  }

  /**
   * Phase 4 — set the delegation limits. The server CLAMPS these (depth 1-10,
   * runs/cost >= 0), so the store is patched with what was actually stored, not
   * what was typed.
   */
  async setLimits(patch: {
    maxDelegationDepth?: number;
    maxRunsPerTree?: number;
    maxCostPerTree?: number;
  }): Promise<void> {
    useModelStore.getState().setSettings(await updateSettings(patch));
  }

  /** Set a provider key (raw); '' clears it. The store gets the masked result. */
  async setProviderKey(
    which: 'openrouterKey' | 'serperKey' | 'replicateKey',
    value: string
  ): Promise<void> {
    useModelStore.getState().setSettings(await updateSettings({ [which]: value }));
  }
}

export const modelService = new ModelService();
