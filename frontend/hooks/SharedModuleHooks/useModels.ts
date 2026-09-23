import { useCallback, useEffect } from 'react';
import { modelService } from '@/services/modelService';
import type { WebMode } from '@/api/models';
import { useModelStore } from '@/store/modelStore';

/**
 * Hook seam for the model catalogue + settings (Component -> Hook -> Service ->
 * API). Loads settings on mount so the default model is known; the (larger) model
 * list is loaded lazily when a picker opens.
 */
export function useModels() {
  const models = useModelStore((s) => s.models);
  const modelsLoaded = useModelStore((s) => s.modelsLoaded);
  const settings = useModelStore((s) => s.settings);

  useEffect(() => {
    void modelService.loadSettings();
  }, []);

  return {
    models,
    modelsLoaded,
    settings,
    loadModels: useCallback((refresh = false) => modelService.loadModels(refresh), []),
    setDefaultModel: useCallback((model: string) => modelService.setDefaultModel(model), []),
    setImageModel: useCallback((model: string) => modelService.setImageModel(model), []),
    setSpeechModel: useCallback((model: string) => modelService.setSpeechModel(model), []),
    setWebMode: useCallback((mode: WebMode) => modelService.setWebMode(mode), []),
    setProviderKey: useCallback(
      (which: 'openrouterKey' | 'serperKey' | 'replicateKey', value: string) =>
        modelService.setProviderKey(which, value),
      []
    ),
    setLimits: useCallback(
      (patch: {
        maxDelegationDepth?: number;
        maxRunsPerTree?: number;
        maxCostPerTree?: number;
      }) => modelService.setLimits(patch),
      []
    ),
  };
}
