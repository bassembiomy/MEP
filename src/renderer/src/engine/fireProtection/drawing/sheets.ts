/**
 * Fire pump room & tank drawing set (FP-101 … FP-105, plus FP-106 / FP-107 / FP-111 when a standpipe design exists) — A1 sheets laid out left to right.
 */
import type { FireDesignResult } from '../fpTypes';
import { DrawingBuilder } from './drawingBuilder';
import type { Drawing, SheetInfo } from './drawingTypes';
import { titleBlock } from './symbols';
import type { Ctx } from './sheetKit';
import { drawPlanSheet, pickPlanScale } from './sheetPlan';
import { drawSectionSheet, pickSectionScale } from './sheetSection';
import { drawTankSheet, pickTankScale } from './sheetTank';
import { drawSchematicSheet } from './sheetSchematic';
import { drawScheduleSheet } from './sheetSchedules';
import { drawPumpRoomDetailsSheet } from './sheetPumpRoomDetails';
import { drawStandpipeDetailSheet } from './sheetStandpipeDetail';
import { drawStandpipeZoningSheet } from './sheetStandpipeZoning';
import { drawStandpipeRiserSheet, pickStandpipeScale } from './sheetStandpipe';
import { drawExtinguisherDetailSheet, drawExtinguisherLayoutSheet, extinguisherSheetNumber, planExtinguisherLayout } from './sheetExtinguishers';

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
  const frame = (sh: SheetInfo, scaleText: string, stds: string = standards): Ctx => {
    titleBlock(b, sh, {
      project: result.input.projectName,
      projectNumber: result.input.projectNumber,
      drawingTitle: sh.title,
      sheetNumber: sh.number,
      scaleText,
      date: DATE,
      drawnBy: result.input.designer,
      checkedBy: 'CHECKER',
      standards: stds
    });
    return { b, sheet: sh, r: result };
  };

  const planScale = pickPlanScale({ r: result });
  const s1 = add('FP-101', 'FIRE PUMP ROOM - PLAN', planScale);
  drawPlanSheet(frame(s1, `1:${planScale}`));
  const secScale = pickSectionScale({ r: result });
  const s2 = add('FP-102', 'SECTION A-A - SUCTION TRAIN AND SUMP', secScale);
  drawSectionSheet(frame(s2, `1:${secScale}`));
  const tankScale = pickTankScale({ r: result });
  const s3 = add('FP-103', 'FIRE WATER TANK - PLAN, SECTION B-B & SUMP DETAIL', tankScale);
  drawTankSheet(frame(s3, `1:${tankScale}`));
  const s4 = add('FP-104', 'FIRE PUMP SCHEMATIC', 10);
  drawSchematicSheet(frame(s4, 'NTS'));
  const s5 = add('FP-105', 'SCHEDULES & HYDRAULIC CALCULATIONS', 10);
  drawScheduleSheet(frame(s5, 'NTS'));
  if (result.standpipe) {
    const spScale = pickStandpipeScale({ r: result });
    const s6 = add('FP-106', 'STANDPIPE RISER DIAGRAM - ELEVATION', spScale);
    drawStandpipeRiserSheet(frame(s6, `1:${spScale}`));
    const s7 = add('FP-107', 'STANDPIPE FLOOR CONNECTION - DETAILS & SCHEDULE', 20);
    drawStandpipeDetailSheet(frame(s7, '1:20 (DETAILS)'));
  }
  if (result.extinguishers) {
    const feStandards = 'NFPA 10-2022 / IFC 906 / IBC 1003.3.3';
    const lay = planExtinguisherLayout(result);
    lay.pages.forEach((_, i) => {
      const sh = add(extinguisherSheetNumber(i), 'FIRE EXTINGUISHER LAYOUT - SCHEMATIC FLOOR PLANS', lay.scale);
      drawExtinguisherLayoutSheet(frame(sh, `1:${lay.scale}`, feStandards), lay, i);
    });
    const s9 = add('FP-109', 'EXTINGUISHER DETAILS, SCHEDULE & SPECIFICATIONS', 20);
    drawExtinguisherDetailSheet(frame(s9, '1:20 (DETAILS)', feStandards));
  }
  const s10 = add('FP-110', 'PUMP ROOM DETAILS', 20);
  drawPumpRoomDetailsSheet(frame(s10, '1:10 / 1:20 (DETAILS)'));
  if (result.standpipe) {
    const s11 = add('FP-111', 'STANDPIPE ZONING STUDY - WITH PRV vs WITHOUT PRV', 10);
    drawStandpipeZoningSheet(frame(s11, 'NTS'));
  }
  return b.build(sheets);
}
