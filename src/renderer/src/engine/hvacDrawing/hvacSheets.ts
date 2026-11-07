/**
 * HVAC shop drawings (AutoCAD R12 DXF / DWG via the shared fire-drawing kernel): M-101 duct layout plan
 * and M-601 schedules. `combined` holds every sheet left → right.
 */
import type { ProjectMetadata, Zone } from '../../store/projectStore'
import type { Drawing, SheetInfo } from '../fireProtection/drawing/drawingTypes'
import type { Ctx } from '../fireProtection/drawing/sheetKit'
import { titleBlock } from '../fireProtection/drawing/symbols'
import { buildModel } from './hvacModel'
import { drawPlanSheet, pickPlanScale } from './hvacPlan'
import { drawSchedulePage, schedulePageCount } from './hvacSchedules'
import { finishHvacDrawing, newHvacBuilder } from './hvacSymbols'
import type { HvacInput } from './hvacTypes'

export const HVAC_DATE = '2026-11-07'
export const HVAC_STANDARDS =
  'ASHRAE 62.1 / ASHRAE 55 / SMACNA HVAC Duct Construction / ASHRAE Handbook'

interface SheetSpec {
  number: string
  title: string
  scale: number
  scaleText: string
  draw: (c: Ctx) => void
}

function assemble(input: HvacInput, title: string, specs: SheetSpec[]): Drawing {
  const b = newHvacBuilder(title)
  const sheets: SheetInfo[] = []
  let ox = 0
  for (const sp of specs) {
    const sh: SheetInfo = {
      number: sp.number,
      title: sp.title,
      scale: sp.scale,
      paper: 'A1',
      paperWidthMm: 841,
      paperHeightMm: 594,
      originX: ox,
      originY: 0
    }
    ox += 841 * sp.scale + 5000
    sheets.push(sh)
    titleBlock(b, sh, {
      project: input.project.name,
      projectNumber: input.projectNumber,
      drawingTitle: sp.title,
      sheetNumber: sp.number,
      scaleText: sp.scaleText,
      date: HVAC_DATE,
      drawnBy: input.designer,
      checkedBy: 'CHECKER',
      standards: HVAC_STANDARDS
    })
    // the shared helpers only read b / sheet; the fire design result is not used by the HVAC sheets
    sp.draw({ b, sheet: sh, r: undefined as never })
  }
  return finishHvacDrawing(b, sheets)
}

export interface HvacDrawings {
  plan: Drawing
  schedules: Drawing
  combined: Drawing
}

export function generateHvacDrawings(input: {
  zones: Zone[]
  project: ProjectMetadata
  projectNumber: string
  designer: string
}): HvacDrawings {
  const scale = pickPlanScale(buildModel(input.zones, input.project))
  const planSpec: SheetSpec = {
    number: 'M-101',
    title: 'HVAC DUCT LAYOUT PLAN',
    scale,
    scaleText: `1:${scale}`,
    draw: (c) => drawPlanSheet(c, input)
  }
  const pages = schedulePageCount(input)
  const schedSpecs: SheetSpec[] = Array.from({ length: pages }, (_, i) => ({
    number: `M-${601 + i}`,
    title: pages > 1 ? `HVAC SCHEDULES (${i + 1} OF ${pages})` : 'HVAC SCHEDULES',
    scale: 10,
    scaleText: 'NTS',
    draw: (c: Ctx) => drawSchedulePage(c, input, i, pages)
  }))
  return {
    plan: assemble(input, `${input.project.name} - HVAC M-101`, [planSpec]),
    schedules: assemble(input, `${input.project.name} - HVAC M-601`, schedSpecs),
    combined: assemble(input, `${input.project.name} - HVAC shop drawings`, [
      planSpec,
      ...schedSpecs
    ])
  }
}
