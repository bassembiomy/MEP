import { create } from 'zustand'

/** HVAC storey used to place the HVAC plan in the combined MEP model (shared by the HVAC export menu and the Fire BIM tab). */
export interface HvacStoreyInput {
  id: string
  name: string
  /** Finished floor level, mm. */
  elevationMm: number
}

interface BimState {
  hvacStorey: HvacStoreyInput
  setHvacStorey: (p: Partial<HvacStoreyInput>) => void
}

export const useBimStore = create<BimState>((set) => ({
  hvacStorey: { id: 'L1', name: 'Level 1', elevationMm: 0 },
  setHvacStorey: (p) => set((s) => ({ hvacStorey: { ...s.hvacStorey, ...p } }))
}))
