import { create } from 'zustand';
import type { FireDesignInput, FireDesignResult } from '../engine/fireProtection/fpTypes';
import { DEFAULT_FIRE_INPUT } from '../engine/fireProtection/defaults';
import { designFireProtectionSystem } from '../engine/fireProtection/fireProtectionEngine';
import { generateFireDrawings } from '../engine/fireProtection/drawing/sheets';
import type { Drawing } from '../engine/fireProtection/drawing/drawingTypes';

export type Discipline = 'hvac' | 'fire';
export type FireView = 'drawings' | 'calc' | 'pumps' | 'tank' | 'room' | 'checks' | 'report';

interface Computed {
  result: FireDesignResult | null;
  drawing: Drawing | null;
  error: string | null;
}

function compute(input: FireDesignInput): Computed {
  try {
    const result = designFireProtectionSystem(input);
    const drawing = generateFireDrawings(result);
    return { result, drawing, error: null };
  } catch (e) {
    return { result: null, drawing: null, error: e instanceof Error ? e.message : String(e) };
  }
}

interface FireProtectionState extends Computed {
  discipline: Discipline;
  input: FireDesignInput;
  activeView: FireView;
  activeSheet: number;
  setDiscipline: (d: Discipline) => void;
  setInput: (partial: Partial<FireDesignInput>) => void;
  setActiveView: (v: FireView) => void;
  setActiveSheet: (i: number) => void;
  reset: () => void;
}

export const useFireProtectionStore = create<FireProtectionState>((set, get) => ({
  discipline: 'hvac',
  input: DEFAULT_FIRE_INPUT,
  ...compute(DEFAULT_FIRE_INPUT),
  activeView: 'drawings',
  activeSheet: 0,
  setDiscipline: (discipline) => set({ discipline }),
  setInput: (partial) => {
    const input = { ...get().input, ...partial };
    const c = compute(input);
    // Keep the last good result/drawing visible while the input is invalid.
    set((s) => ({
      input,
      error: c.error,
      result: c.result ?? s.result,
      drawing: c.drawing ?? s.drawing
    }));
  },
  setActiveView: (activeView) => set({ activeView }),
  setActiveSheet: (activeSheet) => set({ activeSheet }),
  reset: () => set({ input: DEFAULT_FIRE_INPUT, ...compute(DEFAULT_FIRE_INPUT), activeSheet: 0 })
}));
