import React from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Circle,
  GraduationCap,
  Lightbulb,
  PlayCircle,
  RotateCcw
} from 'lucide-react'
import { useFireProtectionStore, type FireView } from '../store/fireProtectionStore'
import type { FireDesignInput, FireDesignResult } from '../engine/fireProtection/fpTypes'
import { LEARNING_EXAMPLE_INPUT } from '../engine/fireProtection/learningExample'
import { HAZARD_DESIGN } from '../engine/fireProtection/standards/nfpa13'
import { formatPipeSize } from '../engine/fireProtection/standards/pipeData'
import { gpmToLpm, psiToBar } from '../engine/fireProtection/hydraulics'

/** Actions a learning step can trigger. */
interface LearningApi {
  setInput: (partial: Partial<FireDesignInput>) => void
  setActiveView: (v: FireView) => void
  setActiveSheet: (i: number) => void
  loadExample: () => void
  input: FireDesignInput
}

interface StepAction {
  label: string
  run: (api: LearningApi) => void
}

interface LearningStep {
  title: string
  /** Where to look in the application. */
  where: string
  /** Explanation paragraphs (what the step teaches and which standard applies). */
  body: string[]
  /** Live values read from the current design so the explanation always matches the engine. */
  live: (r: FireDesignResult, i: FireDesignInput) => [string, string][]
  /** "Try it" buttons. */
  actions: StepAction[]
  tip?: string
}

const f0 = (n: number): string => n.toFixed(0)
const f1 = (n: number): string => n.toFixed(1)
const flowTxt = (gpm: number): string => `${f0(gpm)} gpm (${f0(gpmToLpm(gpm))} L/min)`
const presTxt = (psi: number): string => `${f1(psi)} psi (${f1(psiToBar(psi))} bar)`
const open = (view: FireView): StepAction => ({
  label: `Open the ${VIEW_LABEL[view]} tab`,
  run: (a) => a.setActiveView(view)
})

const VIEW_LABEL: Record<FireView, string> = {
  learning: 'Learning',
  drawings: 'Drawings',
  calc: 'Hydraulic Calc',
  standpipe: 'Standpipe',
  pumps: 'Pumps',
  tank: 'Tank & Sump',
  room: 'Pump Room',
  checks: 'Checks',
  report: 'Report'
}

const STEPS: LearningStep[] = [
  {
    title: 'Welcome - how the application works',
    where: 'Whole Fire Fighting workspace',
    body: [
      'The Fire Fighting branch designs a complete fire water supply: sprinkler demand (NFPA 13), standpipe demand on every floor (NFPA 14), fire pumps and jockey pump (NFPA 20), the fire water tank with its suction sump (NFPA 22), the pump room layout and a 2D DXF drawing set.',
      'The workflow is always the same: (1) enter data in the DESIGN INPUTS column on the left, (2) the engine recalculates instantly, (3) read the results in the tabs, (4) fix anything flagged in Checks, (5) export the drawings (DXF) and the calculation report.',
      'This tutorial uses a ready-made example: a 7-storey office building (Basement, Ground and 5 office floors) with two stair standpipes. Load it first - your current design will be replaced (use Reset to go back to the default project).'
    ],
    live: (r, i) => [
      ['Project', i.projectName],
      [
        'Building levels',
        i.building ? `${i.building.floors.length} (incl. roof)` : 'simple mode (no floors)'
      ],
      ['Checks', `${r.checks.filter((c) => c.status === 'pass').length} pass / ${r.checks.length}`]
    ],
    actions: [{ label: 'Load the learning example', run: (a) => a.loadExample() }],
    tip: 'Every number in the "Live values" box is read from the current design, so you can change inputs at any step and watch the effect.'
  },
  {
    title: 'Step 1 - Hazard classification & sprinkler design point',
    where: 'Inputs → SPRINKLER (NFPA 13)',
    body: [
      'Start by classifying the occupancy. Offices are Light Hazard; parking garages and plant rooms are typically Ordinary Hazard Group 1/2; storage can be Extra Hazard.',
      'The hazard selects the NFPA 13 density/area design point (gpm/ft² over the remote design area), the maximum coverage per sprinkler, the hose stream allowance and the water supply duration. Leave Density / Design Area blank to use the NFPA defaults, or type a value to override.',
      'K-factor: K = 5.6 is the standard ½" sprinkler. Flow from one sprinkler is q = K√P, and the end sprinkler needs at least 7 psi.'
    ],
    live: (r, i) => {
      const s = r.demand.sprinkler
      return [
        ['Hazard', HAZARD_DESIGN[i.hazard].label],
        ['Design point', `${s.densityGpmFt2} gpm/ft² over ${f0(s.designAreaFt2)} ft²`],
        ['Coverage / spacing', `${f0(s.coverageFt2)} ft² per head, S = ${f1(s.spacingFt)} ft`],
        [
          'Heads in remote area',
          `${s.sprinklersInArea} (${s.branchLines} branch lines × ${s.headsPerBranch})`
        ],
        ['Remote head', `${f1(s.minHeadFlowGpm)} gpm @ ${f1(s.remoteHeadPressurePsi)} psi`]
      ]
    },
    actions: [
      {
        label: 'Try: change hazard to Ordinary Group 2',
        run: (a) => a.setInput({ hazard: 'ordinary-2' })
      },
      { label: 'Back to Light Hazard', run: (a) => a.setInput({ hazard: 'light' }) }
    ],
    tip: 'Switching to Ordinary Group 2 doubles the density (0.10 → 0.20 gpm/ft²) - watch the sprinkler flow and the tank volume grow.'
  },
  {
    title: 'Step 2 - Read the hydraulic calculation (Elite style)',
    where: 'Hydraulic Calc tab',
    body: [
      'The engine calculates node-to-node from the most remote sprinkler back to the pump, exactly like Elite Fire / HASS: each row is one pipe segment.',
      'Columns: q = flow added at the node, Q = flow in the pipe, Size / ID / C = pipe data, L = length, Fteq = fitting equivalent length (NFPA 13 table), Pf/ft = Hazen-Williams friction 4.52·Q^1.85 / (C^1.85·d^4.87), Pf = friction loss, Pe = elevation pressure 0.433 psi/ft, Pt = total pressure at each end.',
      'The last row ends at node PD = pump discharge flange. That is the pressure the pumps must deliver for the sprinklers.'
    ],
    live: (r) => {
      const s = r.demand.sprinkler
      const riser = s.rows.find((x) => x.fromNode === 'RT')
      return [
        ['Sprinkler flow', flowTxt(s.sprinklerFlowGpm)],
        ['Pressure at PD', presTxt(s.pressureAtPumpDischargePsi)],
        [
          'Riser elevation pressure',
          riser ? `${f1(riser.pePsi)} psi over ${f1(riser.elevationFt)} ft` : '-'
        ],
        ['Rows in the table', String(s.rows.length)]
      ]
    },
    actions: [open('calc')],
    tip: 'In detailed mode the sprinkler riser height is taken from the top sprinklered floor of the building, so the elevation term is real.'
  },
  {
    title: 'Step 3 - Enter the building floor by floor',
    where: 'Inputs → BUILDING & FLOORS',
    body: [
      'Tick "Detailed floor-by-floor standpipe design" to describe the building. Use the floor generator (basements, ground height, number of upper floors, typical height) to create the floor table quickly, then edit any row: name, FFL level (m), floor-to-floor height, usage, area, sprinklered, hose connection.',
      'Levels are relative to the Ground Floor FFL (±0.000). The pump room FFL is usually negative (basement). After editing a height press "Recalculate levels from heights".',
      'Roof slope < 4 in 12 means a roof hose connection is required (NFPA 14 §7.3.2.2). The fire-department access level is used for the high-rise test (> 75 ft, IBC §202).'
    ],
    live: (_r, i) => {
      const b = i.building
      if (!b) return [['Detailed design', 'OFF - load the example or tick the box']]
      const occupied = b.floors.filter((x) => !x.isRoof)
      return [
        ['Levels', b.floors.map((x) => x.id).join(', ')],
        [
          'Lowest / highest FFL',
          `${occupied[0].elevationM.toFixed(3)} / ${occupied[occupied.length - 1].elevationM.toFixed(3)} m`
        ],
        ['Pump room FFL', `${b.pumpRoomFloorElevationM.toFixed(3)} m`],
        ['Roof hose connection', b.roofSlopeLessThan4in12 ? 'required (flat roof)' : 'not required']
      ]
    },
    actions: [
      {
        label: 'Try: add a 6th office floor',
        run: (a) => {
          const b = a.input.building
          if (!b) return
          const occ = b.floors.filter((x) => !x.isRoof)
          const top = occ[occ.length - 1]
          const roof = b.floors[b.floors.length - 1]
          const n = occ.filter((x) => x.id.startsWith('L')).length + 1
          const newFloor = {
            ...top,
            id: `L${n}`,
            name: `Level ${n}`,
            elevationM: Math.round((top.elevationM + top.floorToFloorM) * 1000) / 1000
          }
          const newRoof = {
            ...roof,
            elevationM: Math.round((newFloor.elevationM + newFloor.floorToFloorM) * 1000) / 1000
          }
          a.setInput({ building: { ...b, floors: [...occ, newFloor, newRoof] } })
        }
      },
      {
        label: 'Restore the example building',
        run: (a) => a.setInput({ building: LEARNING_EXAMPLE_INPUT.building })
      }
    ]
  },
  {
    title: 'Step 4 - Standpipe design & the governing riser',
    where: 'Inputs → STANDPIPE DESIGN, then the Standpipe tab',
    body: [
      'List every stair standpipe with its horizontal run to the pump room and whether that stair reaches the roof. NFPA 14 requires a 2½" hose valve on every floor landing of each exit stair, 900-1500 mm above the floor.',
      'Class I demand: 500 gpm for the first standpipe (250 gpm at each of the two topmost outlets) + 250 gpm for each additional standpipe, max 1000 gpm in a sprinklered building, with 100 psi residual at the topmost outlet.',
      'The engine calculates every riser as if it were the remote one and keeps the worst - that is the governing riser. Its node table runs from the top hose valve (H1) down every floor (S1, S2 …) to the riser base (SB) and the pump (PD).'
    ],
    live: (r) => {
      const s = r.standpipe
      if (!s) return [['Standpipe', 'not calculated - enable the detailed design']]
      return [
        ['Governing riser', s.governingRiserTag],
        [
          'Demand at pump',
          `${flowTxt(s.demandFlowGpm)} @ ${presTxt(s.pressureAtPumpDischargePsi)}`
        ],
        [
          'Riser / supply main',
          `${formatPipeSize(s.riserSizeIn)} / ${formatPipeSize(s.supplyMainSizeIn)}`
        ],
        [
          'Risers',
          s.risers.map((x) => `${x.tag}: ${f1(x.requiredPressureAtPumpPsi)} psi`).join(' · ')
        ]
      ]
    },
    actions: [open('standpipe')]
  },
  {
    title: 'Step 5 - Outlet pressures & pressure-regulating valves',
    where: 'Standpipe tab → floor tables (amber rows)',
    body: [
      'For every outlet on every floor the engine gives the static pressure (pump at churn + maximum tank head, no flow) and the residual pressure (system flowing at demand).',
      'NFPA 14 §7.2.3: where the static pressure at a 2½" hose outlet exceeds 175 psi a pressure-regulating device (PRV) is required to limit it to 175 psi. These rows are highlighted in amber; the low floors need them because they get the full pump pressure plus the height of the building.',
      'The two topmost outlets of the governing riser are the flowing outlets (blue rows).'
    ],
    live: (r) => {
      const s = r.standpipe
      if (!s) return [['Standpipe', 'not calculated']]
      const all = s.risers.flatMap((x) => x.outlets)
      const low = all.reduce((a, b) => (a.staticPsi > b.staticPsi ? a : b))
      return [
        ['Highest static', `${f0(low.staticPsi)} psi at ${low.standpipeTag} ${low.floorName}`],
        [
          'PRV outlets',
          s.risers
            .map(
              (x) =>
                `${x.tag}: ${
                  x.outlets
                    .filter((o) => o.prvRequired)
                    .map((o) => o.floorId)
                    .join(', ') || 'none'
                }`
            )
            .join(' · ')
        ],
        [
          'Drain riser',
          s.drainRiserIn ? `${formatPipeSize(s.drainRiserIn)} beside each riser` : 'not required'
        ]
      ]
    },
    actions: [open('standpipe')]
  },
  {
    title: 'Step 6 - Fire pump selection (NFPA 20)',
    where: 'Inputs → PUMP SET, then the Pumps tab',
    body: [
      'The pump is sized for the governing demand (the larger of sprinkler + inside hose, or standpipe). The rated flow is the next NFPA 20 standard capacity; the rated pressure is the demand pressure minus the suction pressure at low water level, rounded up to 5 psi.',
      'The curve must stay inside the NFPA 20 limits: shut-off (churn) ≤ 140 % of rated pressure and ≥ 65 % of rated pressure at 150 % flow. The motor is sized for the maximum brake horsepower on the curve; the diesel engine is derated for altitude and temperature.',
      'The jockey pump keeps the system pressurised; the start/stop setpoints are staggered (jockey → duty → standby) so the main pumps only start on a real demand.'
    ],
    live: (r) => {
      const p = r.pumps
      const fp1 = p.mainPumps[0]
      return [
        [
          'Governing case',
          `${r.demand.governingCase}: ${flowTxt(r.demand.pumpDemandFlowGpm)} @ ${f1(r.demand.pumpDemandPressurePsi)} psi`
        ],
        [
          'Rated point',
          `${fp1.ratedFlowGpm} gpm @ ${fp1.ratedNetPressurePsi} psi (${fp1.pumpType})`
        ],
        ['Churn / 150 %', `${f1(fp1.churnPressurePsi)} psi / ${f1(fp1.pressureAt150Psi)} psi`],
        ['Drivers', p.mainPumps.map((x) => `${x.tag} ${x.driver} ${x.driverHp} HP`).join(' · ')],
        [
          'Jockey',
          `${p.jockey.ratedFlowGpm} gpm, stop ${p.setpoints.jockeyStopPsi} / start ${p.setpoints.jockeyStartPsi} psi`
        ]
      ]
    },
    actions: [
      open('pumps'),
      { label: 'Try: two diesel pumps', run: (a) => a.setInput({ arrangement: 'diesel+diesel' }) },
      {
        label: 'Back to electric + diesel',
        run: (a) => a.setInput({ arrangement: 'electric+diesel' })
      }
    ]
  },
  {
    title: 'Step 7 - Fire water tank & suction sump (NFPA 22)',
    where: 'Inputs → WATER TANK, then the Tank & Sump tab',
    body: [
      'Required storage = (sprinkler flow + total hose allowance) × duration, or standpipe flow × 30 min, whichever is larger. The tank is split into two compartments so one can be cleaned while the other stays in service.',
      'Each pump draws from a sump pit through a turned-down elbow with an anti-vortex plate (≥ 2 × pipe diameter), so the whole tank volume above the floor is usable. The suction must be flooded (tank floor above the pump centre-line) for horizontal pumps.',
      'Choose the material (reinforced concrete, GRP panels or pressed steel) and the effective water depth; the plan dimensions follow from the volume.'
    ],
    live: (r) => {
      const t = r.tank
      return [
        [
          'Required / provided',
          `${f1(t.requiredEffectiveM3)} m³ / ${f1(t.providedEffectiveM3)} m³`
        ],
        [
          'Internal size',
          `${t.internalLengthM} × ${t.internalWidthM} m × ${t.effectiveDepthM} m effective`
        ],
        [
          'Sump pit',
          `${t.sump.pitLengthMm} × ${t.sump.pitWidthMm} × ${t.sump.pitDepthMm} mm, plate ${t.sump.vortexPlateMm} mm`
        ],
        ['Refill time', `${f1(t.refillHours)} h (limit 8 h)`]
      ]
    },
    actions: [
      open('tank'),
      {
        label: 'Try: GRP sectional tank',
        run: (a) => a.setInput({ tankMaterial: 'grp-sectional' })
      },
      { label: 'Back to concrete', run: (a) => a.setInput({ tankMaterial: 'reinforced-concrete' }) }
    ]
  },
  {
    title: 'Step 8 - The pump room layout',
    where: 'Pump Room tab and drawing FP-101',
    body: [
      'The room is laid out automatically: suction pipes from the tank wall with OS&Y gate valve, ≥ 10 pipe diameters straight run and eccentric reducer; pumps on concrete pads; discharge with check and butterfly valves into the header; test line with flow meter back to the tank and a test header outside.',
      'Controllers stand on the east wall with at least 1.0 m clear working space (NFPA 70 §110.26). A 300 mm grated trench at 1 % slope collects drips into a drain pit. A high-rise building gets a 2-hour rated pump room (IBC §913.2.1).'
    ],
    live: (r) => {
      const rm = r.room
      return [
        [
          'Room (internal)',
          `${rm.lengthMm} × ${rm.widthMm} mm, clear height ${rm.clearHeightMm} mm`
        ],
        ['Fire rating', `${rm.fireRatingHours} h`],
        ['Equipment', rm.equipment.map((e) => e.tag).join(', ')],
        [
          'Trench',
          `${rm.trench.widthMm} mm wide, ${f0(rm.trench.lengthMm)} mm long, capacity ${f0(rm.trench.capacityGpm)} gpm`
        ]
      ]
    },
    actions: [
      open('room'),
      {
        label: 'Show drawing FP-101',
        run: (a) => {
          a.setActiveSheet(0)
          a.setActiveView('drawings')
        }
      }
    ]
  },
  {
    title: 'Step 9 - Compliance checks: learn from a failure',
    where: 'Checks tab',
    body: [
      'Every rule the engine applies is reported as PASS, WARN or FAIL with the code reference and the actual numbers. Always review this tab before issuing drawings.',
      'Try it: set the system component rating to 175 psi. This building needs about 190 psi at the pumps, so the "components rating" checks fail - standard 175 psi valves and fittings are not enough and 300 psi components are required. Then restore 300 psi.',
      'Second experiment: set the hose valve height to 1700 mm - NFPA 14 §7.3.1.1 allows only 900-1500 mm, so the check fails.'
    ],
    live: (r) => {
      const bad = r.checks.filter((c) => c.status !== 'pass')
      return [
        [
          'Pass / warn / fail',
          `${r.checks.filter((c) => c.status === 'pass').length} / ${r.checks.filter((c) => c.status === 'warn').length} / ${r.checks.filter((c) => c.status === 'fail').length}`
        ],
        [
          'Not passing',
          bad.length ? bad.map((c) => c.title).join(' · ') : 'none - the design is compliant'
        ]
      ]
    },
    actions: [
      open('checks'),
      {
        label: 'Try: 175 psi components',
        run: (a) => a.setInput({ systemComponentRatingPsi: 175 })
      },
      {
        label: 'Try: hose valve at 1700 mm',
        run: (a) =>
          a.input.standpipeDesign &&
          a.setInput({ standpipeDesign: { ...a.input.standpipeDesign, hoseValveHeightMm: 1700 } })
      },
      {
        label: 'Fix both (300 psi, 1200 mm)',
        run: (a) =>
          a.setInput({
            systemComponentRatingPsi: 300,
            ...(a.input.standpipeDesign
              ? { standpipeDesign: { ...a.input.standpipeDesign, hoseValveHeightMm: 1200 } }
              : {})
          })
      }
    ]
  },
  {
    title: 'Step 10 - The drawing set & DXF export',
    where: 'Drawings tab',
    body: [
      'The drawings are generated from the same results: FP-101 pump room plan, FP-102 section A-A through the suction and sump, FP-103 tank plan / section / sump detail, FP-104 pump schematic, FP-105 schedules & hydraulic calculations, FP-106 standpipe riser diagram (every floor, true levels), FP-107 typical floor connection side view, FDC and floor schedule.',
      'Use the mouse wheel to zoom and drag to pan, "Fit" to reset. "Export DXF" saves all sheets in one AutoCAD R12 DXF (millimetres, layers prefixed FP-), which opens in AutoCAD, BricsCAD, LibreCAD, etc.'
    ],
    live: () => {
      const d = useFireProtectionStore.getState().drawing
      return [
        ['Sheets', d ? d.sheets.map((s) => `${s.number} (1:${s.scale})`).join(' · ') : '-'],
        ['Entities', d ? String(d.entities.length) : '-']
      ]
    },
    actions: [
      {
        label: 'Show FP-106 riser diagram',
        run: (a) => {
          a.setActiveSheet(5)
          a.setActiveView('drawings')
        }
      },
      {
        label: 'Show FP-107 floor connection',
        run: (a) => {
          a.setActiveSheet(6)
          a.setActiveView('drawings')
        }
      }
    ]
  },
  {
    title: 'Step 11 - Report & your own project',
    where: 'Report tab',
    body: [
      'The Report tab contains the full calculation in text form (design basis, node tables, pumps, tank, pump room, standpipe floor schedule and all checks) - download it and attach it to the drawings.',
      'To design your own project: press Reset (or keep this example), enter your project data, hazard, building floors and standpipe locations, then work through the tabs in the same order as this tutorial.',
      "Before issue: confirm the code editions adopted by your Authority Having Jurisdiction and replace typical equipment data (pump curves, footprints, valve losses) with the selected manufacturer's certified data."
    ],
    live: (r, i) => [
      ['Project', `${i.projectName} (${i.projectNumber})`],
      [
        'Design',
        `${r.pumps.mainPumps[0].ratedFlowGpm} gpm @ ${r.pumps.mainPumps[0].ratedNetPressurePsi} psi, tank ${f1(r.tank.providedEffectiveM3)} m³`
      ]
    ],
    actions: [open('report')]
  }
]

/** Guided tutorial for the Fire Fighting branch, driven by the learning example project. */
export const LearningPanel: React.FC = () => {
  const {
    result,
    input,
    learningStep,
    setLearningStep,
    setInput,
    setActiveView,
    setActiveSheet,
    loadLearningExample
  } = useFireProtectionStore()
  const [visited, setVisited] = React.useState<Set<number>>(() => new Set([0]))

  const stepIndex = Math.min(Math.max(learningStep, 0), STEPS.length - 1)
  const step = STEPS[stepIndex]
  const isExample = input.projectNumber === LEARNING_EXAMPLE_INPUT.projectNumber

  const go = (i: number): void => {
    setLearningStep(i)
    setVisited((v) => new Set(v).add(i))
  }
  const api: LearningApi = {
    setInput,
    setActiveView,
    setActiveSheet,
    loadExample: loadLearningExample,
    input
  }

  let live: [string, string][] = []
  if (result) {
    try {
      live = step.live(result, input)
    } catch {
      live = [['Live values', 'not available for the current design']]
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
      {/* Step list */}
      <div className="bg-neutral-900 border border-neutral-850 rounded-2xl p-4 flex flex-col gap-1 h-fit">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neutral-300 mb-2">
          <GraduationCap size={16} className="text-orange-500" />
          Learning example
        </div>
        <div className="text-[10px] text-neutral-500 mb-2">
          {visited.size} of {STEPS.length} steps visited
          <div className="h-1 bg-neutral-800 rounded mt-1">
            <div
              className="h-1 bg-gradient-to-r from-red-600 to-orange-500 rounded"
              style={{ width: `${(visited.size / STEPS.length) * 100}%` }}
            />
          </div>
        </div>
        {STEPS.map((s, i) => (
          <button
            key={s.title}
            onClick={() => go(i)}
            className={`flex items-start gap-2 text-left text-[11px] px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
              i === stepIndex
                ? 'bg-red-600/20 text-orange-200'
                : 'text-neutral-400 hover:bg-neutral-850 hover:text-neutral-200'
            }`}
          >
            {visited.has(i) ? (
              <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-emerald-500" />
            ) : (
              <Circle size={13} className="shrink-0 mt-0.5 text-neutral-600" />
            )}
            <span>{s.title}</span>
          </button>
        ))}
      </div>

      {/* Step content */}
      <div className="flex flex-col gap-4 min-w-0">
        {!isExample && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-orange-950/30 border border-orange-800/50 rounded-2xl px-4 py-3 text-xs text-orange-200">
            <span>
              The tutorial values refer to the learning example project. Load it to follow along
              (your current inputs will be replaced).
            </span>
            <button
              onClick={loadLearningExample}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-red-600 to-orange-500 text-white font-bold cursor-pointer"
            >
              <PlayCircle size={14} /> Load example
            </button>
          </div>
        )}

        <div className="bg-neutral-900 border border-neutral-850 rounded-2xl p-6 flex flex-col gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
              {stepIndex === 0 ? 'Introduction' : `Step ${stepIndex} of ${STEPS.length - 1}`} ·{' '}
              {step.where}
            </div>
            <h2 className="text-base font-bold text-neutral-100 mt-1 flex items-center gap-2">
              <BookOpen size={18} className="text-orange-500" />
              {step.title}
            </h2>
          </div>
          <div className="flex flex-col gap-2.5 text-xs text-neutral-300 leading-relaxed">
            {step.body.map((p) => (
              <p key={p.slice(0, 40)}>{p}</p>
            ))}
          </div>

          {live.length > 0 && (
            <div className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-emerald-500 font-bold mb-2">
                Live values from the current design
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-x-4 gap-y-1.5 text-xs">
                {live.map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt className="text-neutral-500">{k}</dt>
                    <dd className="font-mono text-neutral-100 break-words">{v}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </div>
          )}

          {step.tip && (
            <div className="flex items-start gap-2 text-xs text-amber-200 bg-amber-950/30 border border-amber-800/40 rounded-xl px-3 py-2">
              <Lightbulb size={14} className="shrink-0 mt-0.5" />
              <span>{step.tip}</span>
            </div>
          )}

          {step.actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {step.actions.map((a) => (
                <button
                  key={a.label}
                  onClick={() => a.run(api)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-neutral-850 text-neutral-200 hover:bg-neutral-800 border border-neutral-700 cursor-pointer"
                >
                  <PlayCircle size={14} className="text-orange-500" />
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <button
            disabled={stepIndex === 0}
            onClick={() => go(stepIndex - 1)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-neutral-900 text-neutral-300 disabled:opacity-30 cursor-pointer disabled:cursor-default"
          >
            <ArrowLeft size={14} /> Previous
          </button>
          <button
            onClick={() => {
              loadLearningExample()
              go(0)
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] text-neutral-500 hover:text-neutral-300 cursor-pointer"
          >
            <RotateCcw size={13} /> Restart with a fresh example
          </button>
          <button
            disabled={stepIndex === STEPS.length - 1}
            onClick={() => go(stepIndex + 1)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-red-600 to-orange-500 text-white disabled:opacity-30 cursor-pointer disabled:cursor-default"
          >
            Next <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
