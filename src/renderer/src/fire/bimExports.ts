import type { Zone, ProjectMetadata } from '../store/projectStore'
import type { BimModel } from '../engine/bim/bimTypes'
import { hvacBimModel } from '../engine/bim/hvacBim'
import { writeModelDxf } from '../engine/bim/modelDxf'
import { writeIfc } from '../engine/bim/ifcWriter'
import { generateHvacDrawings } from '../engine/hvacDrawing/hvacSheets'
import { writeDxf } from '../engine/fireProtection/drawing/dxfWriter'
import { verifyDesigns } from '../engine/verification/designVerification'
import type { FireDesignResult } from '../engine/fireProtection/fpTypes'
import type { HvacStoreyInput } from '../store/bimStore'
import { downloadText, safeFileName } from './download'
import { exportDwgFromApp, type DwgExportStatus } from './dwgExport'

export function buildHvacModel(
  zones: Zone[],
  project: ProjectMetadata,
  storey: HvacStoreyInput,
  projectNumber?: string
): BimModel {
  return hvacBimModel(zones, {
    storeyId: storey.id.trim() || 'L1',
    storeyName: storey.name.trim() || 'Level 1',
    elevationMm: storey.elevationMm,
    scale: project.scale,
    units: project.units,
    projectName: project.name,
    projectNumber
  })
}

export const saveIfc = (model: BimModel, file: string): void =>
  downloadText(file, writeIfc(model), 'application/x-step')

export const saveLinkDxf = (model: BimModel, storeyId: string, file: string): void =>
  downloadText(file, writeModelDxf(model, storeyId), 'application/dxf')

export const saveLinkDwg = (
  model: BimModel,
  storeyId: string,
  file: string
): Promise<DwgExportStatus> => exportDwgFromApp(writeModelDxf(model, storeyId), file)

export type HvacSheetKey = 'plan' | 'schedules'

export function hvacSheetDxf(
  zones: Zone[],
  project: ProjectMetadata,
  which: HvacSheetKey,
  projectNumber = '',
  designer = ''
): string {
  const d = generateHvacDrawings({ zones, project, projectNumber, designer })
  return writeDxf(which === 'plan' ? d.plan : d.schedules)
}

export const hvacSheetFile = (project: ProjectMetadata, which: HvacSheetKey, ext: string): string =>
  `${safeFileName(project.name)}_HVAC_${which === 'plan' ? 'M-101' : 'M-601'}.${ext}`

export function saveVerificationReport(args: {
  fire?: FireDesignResult
  hvac?: { zones: Zone[]; project: ProjectMetadata }
  bim?: BimModel
  fileBase: string
}): { fail: number; warn: number; total: number } {
  const v = verifyDesigns({ fire: args.fire, hvac: args.hvac, bim: args.bim })
  downloadText(`${safeFileName(args.fileBase)}_verification_report.html`, v.html, 'text/html')
  return v.summary
}
