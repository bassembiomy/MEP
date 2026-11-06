import { create } from 'zustand'
import type { FireDesignInput, FireDesignResult } from '../engine/fireProtection/fpTypes'
import { DEFAULT_FIRE_INPUT } from '../engine/fireProtection/defaults'
import { LEARNING_EXAMPLE_INPUT } from '../engine/fireProtection/learningExample'
import { designFireProtectionSystem } from '../engine/fireProtection/fireProtectionEngine'
import { generateFireDrawings } from '../engine/fireProtection/drawing/sheets'
import type { Drawing } from '../engine/fireProtection/drawing/drawingTypes'

export type Discipline = 'hvac' | 'fire'
export type FireView =
  | 'learning'
  | 'drawings'
  | 'calc'
  | 'standpipe'
  | 'extinguishers'
  | 'sprinklers'
  | 'pumps'
  | 'tank'
  | 'room'
  | 'checks'
  | 'report'

interface Computed {
  result: FireDesignResult | null
  drawing: Drawing | null
  error: string | null
}

function compute(input: FireDesignInput): Computed {
  try {
    const result = designFireProtectionSystem(input)
    const drawing = generateFireDrawings(result)
    return { result, drawing, error: null }
  } catch (e) {
    return { result: null, drawing: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Recompute delay after the last input change (keeps typing responsive). */
const RECOMPUTE_DELAY_MS = 180
let recomputeTimer: ReturnType<typeof setTimeout> | null = null

interface FireProtectionState extends Computed {
  /** True while an input change is waiting to be recalculated. */
  pending: boolean
  discipline: Discipline
  input: FireDesignInput
  activeView: FireView
  activeSheet: number
  setDiscipline: (d: Discipline) => void
  setInput: (partial: Partial<FireDesignInput>) => void
  setActiveView: (v: FireView) => void
  setActiveSheet: (i: number) => void
  reset: () => void
  /** Learning tab: current tutorial step (0-based). */
  learningStep: number
  setLearningStep: (i: number) => void
  /** Replace the current design with the learning example project. */
  loadLearningExample: () => void
}

export const useFireProtectionStore = create<FireProtectionState>((set, get) => {
  /** Recalculate the design + drawings for the current input. Keeps the last good result on error. */
  const recompute = (): void => {
    recomputeTimer = null
    const c = compute(get().input)
    set((s) => ({
      pending: false,
      error: c.error,
      result: c.result ?? s.result,
      drawing: c.drawing ?? s.drawing
    }))
  }
  const scheduleRecompute = (): void => {
    if (recomputeTimer) clearTimeout(recomputeTimer)
    recomputeTimer = setTimeout(recompute, RECOMPUTE_DELAY_MS)
  }
  const replaceInput = (input: FireDesignInput): void => {
    if (recomputeTimer) clearTimeout(recomputeTimer)
    recomputeTimer = null
    set({ input, ...compute(input), pending: false, activeSheet: 0 })
  }
  return {
    discipline: 'hvac',
    input: DEFAULT_FIRE_INPUT,
    // The fire design is computed lazily the first time the Fire Fighting branch is opened.
    result: null,
    drawing: null,
    error: null,
    pending: false,
    activeView: 'drawings',
    activeSheet: 0,
    setDiscipline: (discipline) => {
      set({ discipline })
      if (discipline === 'fire' && !get().result && !recomputeTimer) setTimeout(recompute, 0)
    },
    setInput: (partial) => {
      // Inputs update immediately; the heavy recalculation runs once typing pauses.
      set((s) => ({ input: { ...s.input, ...partial }, pending: true }))
      scheduleRecompute()
    },
    setActiveView: (activeView) => set({ activeView }),
    setActiveSheet: (activeSheet) => set({ activeSheet }),
    reset: () => replaceInput(DEFAULT_FIRE_INPUT),
    learningStep: 0,
    setLearningStep: (learningStep) => set({ learningStep }),
    loadLearningExample: () => replaceInput(LEARNING_EXAMPLE_INPUT)
  }
})
