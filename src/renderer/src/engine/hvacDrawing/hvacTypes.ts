import type { ProjectMetadata, Zone } from '../../store/projectStore'

export interface HvacInput {
  zones: Zone[]
  project: ProjectMetadata
  projectNumber: string
  designer: string
}
