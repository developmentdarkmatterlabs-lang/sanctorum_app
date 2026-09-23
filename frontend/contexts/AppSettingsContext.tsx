import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type AppSettings = {
  theme: string;
  fontSize: number;
  fontFamily: string;
};

type AppSettingsContextValue = AppSettings & {
  setTheme: (theme: string) => void;
  setFontSize: (fontSize: number) => void;
  setFontFamily: (fontFamily: string) => void;
};

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  fontSize: 16,
  fontFamily: 'Arial, Helvetica, sans-serif',
};

const AppSettingsContext = createContext<AppSettingsContextValue | undefined>(undefined);

function applySettingsToDOM({ theme, fontSize, fontFamily }: AppSettings): void {
  const root = document.documentElement;

  root.setAttribute('data-theme', theme);
  root.classList.toggle('dark', theme.includes('dark'));
  root.style.fontSize = `${fontSize}px`;
  root.style.fontFamily = fontFamily;
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(DEFAULT_SETTINGS.theme);
  const [fontSize, setFontSize] = useState(DEFAULT_SETTINGS.fontSize);
  const [fontFamily, setFontFamily] = useState(DEFAULT_SETTINGS.fontFamily);

  useEffect(() => {
    applySettingsToDOM({ theme, fontSize, fontFamily });
  }, [theme, fontSize, fontFamily]);

  const value = useMemo(
    () => ({ theme, fontSize, fontFamily, setTheme, setFontSize, setFontFamily }),
    [theme, fontSize, fontFamily]
  );

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings(): AppSettingsContextValue {
  const context = useContext(AppSettingsContext);
  if (!context) {
    throw new Error('useAppSettings must be used within an AppSettingsProvider');
  }
  return context;
}
