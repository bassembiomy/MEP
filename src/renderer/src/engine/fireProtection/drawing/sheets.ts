/**
 * Fire pump room & tank drawing set (FP-101 … FP-105) — A1 sheets laid out left to right.
 */
import type { FireDesignResult } from '../fpTypes';
import { DrawingBuilder } from './drawingBuilder';
import type { Drawing, SheetInfo } from './drawingTypes';
import { titleBlock } from './symbols';
import type { Ctx } from './sheetKit';
import { drawPlanSheet, pickPlanScale } from './sheetPlan';

const GAP = 5000;
const DATE = '2026-10-31';

/** Generate the complete 5-sheet drawing set for a fire pump room and tank design. */
export function generateFireDrawings(result: FireDesignResult): Drawing {
  const b = new DrawingBuilder(`Fire Pump Room & Tank - ${result.input.projectName}`);
  const sheets: SheetInfo[] = [];
  let ox = 0;
  const add = (number: string, title: string, scale: number): SheetInfo => {
    const sh: SheetInfo = { number, title, scale, paper: 'A1', paperWidthMm: 841, paperHeightMm: 594, originX: ox, originY: 0 };
    ox += 841 * scale + GAP;
    sheets.push(sh);
    return sh;
  };
  const standards = 'NFPA 20 / NFPA 22 / NFPA 13 / NFPA 14 / NFPA 24 / NFPA 25 / NFPA 70 ART. 695 / IBC 913 / IPC / UPC';
  const frame = (sh: SheetInfo, scaleText: string): Ctx => {
    titleBlock(b, sh, {
      project: result.input.projectName,
      projectNumber: result.input.projectNumber,
      drawingTitle: sh.title,
      sheetNumber: sh.number,
      scaleText,
      date: DATE,
      drawnBy: result.input.designer,
      checkedBy: 'CHECKER',
      standards
    });
    return { b, sheet: sh, r: result };
  };

  const planScale = pickPlanScale({ r: result });
  const s1 = add('FP-101', 'FIRE PUMP ROOM - PLAN', planScale);
  drawPlanSheet(frame(s1, `1:${planScale}`));
  return b.build(sheets);
}
