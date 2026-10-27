import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { readStorage, writeStorage } from './storage.js';

export type FontStep = 0 | 1 | 2;

interface PreferencesValue {
  fontStep: FontStep;
  setFontStep: (step: FontStep) => void;
  highContrast: boolean;
  toggleHighContrast: () => void;
}

const FONT_KEY = 'rain-burst-font-step';
const CONTRAST_KEY = 'rain-burst-high-contrast';

const PreferencesContext = createContext<PreferencesValue | null>(null);

function initialFontStep(): FontStep {
  const stored = readStorage(FONT_KEY);
  return stored === '1' ? 1 : stored === '2' ? 2 : 0;
}

export function PreferencesProvider({ children }: PropsWithChildren): React.ReactNode {
  const [fontStep, setFontStepState] = useState<FontStep>(initialFontStep);
  const [highContrast, setHighContrast] = useState<boolean>(() => readStorage(CONTRAST_KEY) === '1');

  // Scale the whole site by changing the root font size (all sizes are rem-based).
  useEffect(() => {
    document.documentElement.dataset['font'] = String(fontStep);
  }, [fontStep]);

  useEffect(() => {
    document.documentElement.dataset['contrast'] = highContrast ? 'high' : 'normal';
  }, [highContrast]);

  const value = useMemo<PreferencesValue>(
    () => ({
      fontStep,
      setFontStep: (step) => {
        writeStorage(FONT_KEY, String(step));
        setFontStepState(step);
      },
      highContrast,
      toggleHighContrast: () => {
        setHighContrast((current) => {
          writeStorage(CONTRAST_KEY, current ? '0' : '1');
          return !current;
        });
      },
    }),
    [fontStep, highContrast]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used inside PreferencesProvider');
  }
  return context;
}
