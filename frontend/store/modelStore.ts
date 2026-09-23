import { create } from 'zustand';
import type { AppSettings, ModelInfo } from '@/api/models';

type ModelState = {
  /** Live OpenRouter catalogue, loaded on demand. */
  models: ModelInfo[];
  modelsLoaded: boolean;
  /** App settings, including the global default model. */
  settings: AppSettings | null;

  setModels: (models: ModelInfo[]) => void;
  setSettings: (settings: AppSettings) => void;
};

export const useModelStore = create<ModelState>((set) => ({
  models: [],
  modelsLoaded: false,
  settings: null,

  setModels: (models) => set({ models, modelsLoaded: true }),
  setSettings: (settings) => set({ settings }),
}));
