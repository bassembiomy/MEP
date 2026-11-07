import React, { useMemo, useState } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Download } from 'lucide-react'
import type {
  CheckStatus,
  DesignCheck,
  FireDesignResult,
  FloorLevel,
  HydraulicNodeRow,
  StandpipeSolution,
  StandpipeZone,
  StandpipeZoningStudy
} from '../engine/fireProtection/fpTypes'
import { buildFireCalcReport } from '../engine/fireProtection/report'
import { formatPipeSize } from '../engine/fireProtection/standards/pipeData'
import { gpmToLpm, psiToBar } from '../engine/fireProtection/hydraulics'
import { PumpCurveChart } from './PumpCurveChart'
import { downloadText, safeFileName } from './download'

type R = { result: FireDesignResult }

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-neutral-900 border border-neutral-850 p-5 rounded-2xl flex flex-col gap-3 shadow-xl">
    <div className="text-xs font-bold text-neutral-300 uppercase tracking-wider">{title}</div>
    {children}
  </div>
)

const KV: React.FC<{ rows: [string, React.ReactNode][] }> = ({ rows }) => (
  <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 text-xs">
    {rows.map(([k, v]) => (
      <React.Fragment key={k}>
        <dt className="text-neutral-500">{k}</dt>
        <dd className="text-neutral-200 font-mono text-right">{v}</dd>
      </React.Fragment>
    ))}
  </dl>
)

const Table: React.FC<{
  head: string[]
  rows: React.ReactNode[][]
  dense?: boolean
  rowCls?: (i: number) => string
}> = ({ head, rows, dense, rowCls }) => (
  <div className="overflow-x-auto">
    <table className={`w-full text-left ${dense ? 'text-[10px]' : 'text-xs'}`}>
      <thead>
        <tr className="border-b border-neutral-800 text-neutral-500 uppercase text-[9px] tracking-wide">
          {head.map((h) => (
            <th key={h} className="py-1.5 px-2 font-bold whitespace-nowrap">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={i}
            className={`border-b border-neutral-850 hover:bg-neutral-850/60 ${rowCls ? rowCls(i) : ''}`}
          >
            {r.map((c, j) => (
              <td key={j} className="py-1.5 px-2 font-mono text-neutral-300 whitespace-nowrap">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

const f = (v: number | undefined, d = 1): string =>
  v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(d)

// ───────────────────────── Hydraulic calc ─────────────────────────

const nodeHead = [
  'From',
  'To',
  'Description',
  'K',
  'q gpm',
  'Q gpm',
  'Size',
  'ID in',
  'C',
  'L ft',
  'Fittings',
  'Eq ft',
  'Ltot ft',
  'Pf/ft',
  'Pf psi',
  'Pe psi',
  'Pt start',
  'Pt end',
  'v fps'
]
const nodeRow = (r: HydraulicNodeRow): React.ReactNode[] => [
  r.fromNode,
  r.toNode,
  r.description,
  f(r.kFactor, 1),
  f(r.flowAddedGpm, 1),
  f(r.totalFlowGpm, 1),
  f(r.nominalIn, 2),
  f(r.idIn, 3),
  f(r.c, 0),
  f(r.lengthFt, 1),
  r.fittingsDesc || '-',
  f(r.fittingsEqFt, 1),
  f(r.totalLengthFt, 1),
  f(r.pfPerFt, 4),
  f(r.pfPsi, 2),
  f(r.pePsi, 2),
  f(r.ptStartPsi, 2),
  f(r.ptEndPsi, 2),
  f(r.velocityFps, 1)
]

export const HydraulicCalcPanel: React.FC<R> = ({ result }) => {
  const d = result.demand
  const s = d.sprinkler
  return (
    <div className="flex flex-col gap-5">
      <Card title="Demand summary">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <KV
            rows={[
              ['Density', `${f(s.densityGpmFt2, 3)} gpm/ft²`],
              ['Design area', `${f(s.designAreaFt2, 0)} ft²`],
              ['Coverage / spacing', `${f(s.coverageFt2, 0)} ft² / ${f(s.spacingFt, 1)} ft`],
              ['Sprinklers in area', s.sprinklersInArea],
              ['Branch lines x heads', `${s.branchLines} x ${s.headsPerBranch}`],
              ['Remote head pressure', `${f(s.remoteHeadPressurePsi, 1)} psi`]
            ]}
          />
          <KV
            rows={[
              ['Sprinkler flow', `${f(s.sprinklerFlowGpm, 0)} gpm`],
              ['Sprinkler @ pump discharge', `${f(s.pressureAtPumpDischargePsi, 1)} psi`],
              ['Inside hose', `${f(d.hoseAllowanceInsideGpm, 0)} gpm`],
              ['Total hose allowance', `${f(d.hoseAllowanceTotalGpm, 0)} gpm`],
              ['Duration', `${f(d.durationMin, 0)} min`],
              [
                'Required storage',
                `${f(d.requiredStorageGal, 0)} gal (${f(result.tank.requiredEffectiveM3, 0)} m³)`
              ]
            ]}
          />
          <KV
            rows={[
              ['Standpipe', d.standpipe.applicable ? 'Applicable' : 'N/A'],
              ['Standpipe flow', `${f(d.standpipe.flowGpm, 0)} gpm`],
              ['Standpipe residual', `${f(d.standpipe.residualPressurePsi, 0)} psi`],
              ['Standpipe @ pump discharge', `${f(d.standpipe.pressureAtPumpDischargePsi, 1)} psi`],
              ['Governing case', d.governingCase],
              [
                'Pump demand',
                <span key="pd" className="text-orange-400 font-bold">
                  {f(d.pumpDemandFlowGpm, 0)} gpm @ {f(d.pumpDemandPressurePsi, 1)} psi
                </span>
              ]
            ]}
          />
        </div>
      </Card>
      <Card title="Hydraulic node calculation - sprinkler path to pump discharge">
        <Table head={nodeHead} rows={s.rows.map(nodeRow)} dense />
      </Card>
    </div>
  )
}

// ───────────────────────── Standpipe (NFPA 14) ─────────────────────────

export const StandpipePanel: React.FC<R> = ({ result }) => {
  const sp = result.standpipe
  if (!sp) {
    return (
      <Card title="Standpipe system (NFPA 14)">
        <div className="text-xs text-neutral-400">
          No detailed standpipe design. Enable{' '}
          <strong>Detailed floor-by-floor standpipe design</strong> under{' '}
          <em>Building &amp; Floors</em> in the input panel to enter the floors and standpipe
          locations and calculate every riser node-to-node.
        </div>
      </Card>
    )
  }
  const gov = sp.risers.find((r) => r.tag === sp.governingRiserTag)
  const q = sp.demandFlowGpm
  const p = sp.pressureAtPumpDischargePsi
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Card title="Design basis">
          <KV
            rows={[
              [
                'Governing riser',
                <span key="g" className="text-orange-400 font-bold">
                  {sp.governingRiserTag}
                </span>
              ],
              [
                'Q @ P at pump',
                <span key="q" className="text-orange-400 font-bold">
                  {f(q, 0)} gpm @ {f(p, 1)} psi
                </span>
              ],
              ['', `${f(gpmToLpm(q), 0)} L/min @ ${f(psiToBar(p), 1)} bar`],
              ['System', `${sp.systemType}${sp.combined ? ' (combined)' : ''}`],
              ['Class', sp.standpipeClass],
              ['Top outlet residual', `${f(sp.topOutletResidualPsi, 0)} psi`]
            ]}
          />
        </Card>
        <Card title="Pipe sizes & building">
          <KV
            rows={[
              [
                'Riser size',
                `${formatPipeSize(sp.riserSizeIn)} (min ${formatPipeSize(sp.minRiserSizeIn)})`
              ],
              ['Supply main', formatPipeSize(sp.supplyMainSizeIn)],
              [
                'Building height (above FD access)',
                `${f(sp.buildingHeightFt, 1)} ft / ${f(sp.buildingHeightFt * 0.3048, 1)} m`
              ],
              ['High-rise (> 75 ft)', sp.highRise ? 'Yes' : 'No'],
              ['Pump centre-line', `${f(sp.pumpCLElevationM, 2)} m`],
              ['Hose valve height', `${f(sp.hoseValveHeightMm, 0)} mm`]
            ]}
          />
        </Card>
        <Card title="FDC & drains">
          <KV
            rows={[
              ['FDC inlets', `${sp.fdc.inlets} x ${formatPipeSize(sp.fdc.inletSizeIn)}`],
              ['FDC pipe', formatPipeSize(sp.fdc.pipeSizeIn)],
              ['FDC height above grade', `${f(sp.fdc.heightAboveGradeMm, 0)} mm`],
              ['Hydrant distance', `${f(sp.fdc.distanceToHydrantM, 1)} m`],
              ['Drain riser', sp.drainRiserIn ? formatPipeSize(sp.drainRiserIn) : 'Not required'],
              ['Main drain', formatPipeSize(sp.mainDrainIn)]
            ]}
          />
        </Card>
      </div>

      {sp.risers.map((r) => (
        <Card
          key={r.tag}
          title={`${r.tag} - ${r.location} (${formatPipeSize(r.sizeIn)} riser${r.tag === sp.governingRiserTag ? ', governing' : ''})`}
        >
          <div className="text-[10px] text-neutral-500 font-mono">
            Base {f(r.bottomElevationM, 2)} m · top outlet {f(r.topElevationM, 2)} m · run to pump{' '}
            {f(r.horizontalRunToPumpM, 1)} m · required at pump {f(r.requiredPressureAtPumpPsi, 1)}{' '}
            psi ({f(psiToBar(r.requiredPressureAtPumpPsi), 1)} bar)
            {r.floorControlValveFloors.length > 0 &&
              ` · floor control valves on ${r.floorControlValveFloors.length} floors`}
          </div>
          <Table
            dense
            head={[
              'Floor',
              'FFL m',
              'Outlet el. m',
              'Size',
              'Flowing gpm',
              'Static psi',
              'Residual psi',
              'PRV',
              'PRV set psi'
            ]}
            rows={[...r.outlets]
              .reverse()
              .map((o) => [
                o.isRoofOutlet ? `${o.floorName} (roof)` : o.floorName,
                f(o.elevationM - sp.hoseValveHeightMm / 1000, 2),
                f(o.elevationM, 2),
                formatPipeSize(o.sizeIn),
                o.flowing ? f(o.flowGpm, 0) : '-',
                f(o.staticPsi, 1),
                f(o.residualPsi, 1),
                o.prvRequired ? 'Yes' : '-',
                o.prvSetPsi !== null ? f(o.prvSetPsi, 0) : '-'
              ])}
            rowCls={(i) => {
              const o = [...r.outlets].reverse()[i]
              if (o.prvRequired) return 'bg-amber-500/10 text-amber-300'
              if (o.flowing) return 'bg-sky-500/10'
              return ''
            }}
          />
        </Card>
      ))}
      {gov && (
        <div className="text-[10px] text-neutral-600 -mt-3">
          Amber rows need a pressure-regulating device; blue rows are the flowing outlets of the
          hydraulic design (top of the floors listed first).
        </div>
      )}

      <Card title={`Hydraulic node calculation - ${sp.governingRiserTag} to pump discharge`}>
        <Table head={nodeHead} rows={sp.rows.map(nodeRow)} dense />
      </Card>

      <StandpipeZoningPanel study={sp.zoning} floors={result.input.building?.floors ?? []} />

      <Card title="Standpipe checks">
        <div className="flex flex-col divide-y divide-neutral-850">
          {sp.checks.length === 0 && (
            <div className="text-xs text-neutral-500 py-2">No checks.</div>
          )}
          {sp.checks.map((c) => (
            <div key={c.id} className="py-2.5 flex gap-3 items-start">
              <div className="pt-0.5 w-16 shrink-0">
                <StatusChip status={c.status} />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="text-xs font-semibold text-neutral-200">{c.title}</div>
                <div className="text-[10px] text-orange-400/80 font-mono">{c.reference}</div>
                <div className="text-[11px] text-neutral-400 leading-relaxed">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ───────────────────────── Standpipe zoning: with PRV vs without PRV ─────────────────────────

const ZONE_FILL = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c']

/** Zone bands against floor elevations (true levels), stations marked on the left. */
const ZoningSchematic: React.FC<{ sol: StandpipeSolution; floors: FloorLevel[] }> = ({
  sol,
  floors
}) => {
  const sorted = [...floors].sort((a, b) => a.elevationM - b.elevationM)
  if (sorted.length === 0) return null
  const minE = Math.min(sorted[0].elevationM, ...sol.zones.map((z) => z.station.pumpCLElevationM))
  const maxE = sorted[sorted.length - 1].elevationM
  const span = Math.max(maxE - minE, 1)
  const H = 190
  const top = 8
  const y = (e: number): number => top + H - ((e - minE) / span) * H
  const labelEvery = Math.max(1, Math.ceil(sorted.length / 10))
  return (
    <svg
      viewBox={`0 0 260 ${H + top * 2}`}
      className="w-full max-w-[260px] h-auto self-center"
      role="img"
      aria-label={`Zone bands for the ${sol.kind === 'with-prv' ? 'with PRV' : 'without PRV'} solution`}
    >
      {sorted.map((fl, i) => (
        <g key={fl.id}>
          <line
            x1={52}
            x2={170}
            y1={y(fl.elevationM)}
            y2={y(fl.elevationM)}
            stroke="#525252"
            strokeWidth={0.6}
            strokeDasharray="2 2"
          />
          {(i % labelEvery === 0 || i === sorted.length - 1) && (
            <text x={48} y={y(fl.elevationM) + 3} textAnchor="end" fontSize={8} fill="#a3a3a3">
              {fl.name.length > 8 ? fl.id : fl.name}
            </text>
          )}
        </g>
      ))}
      {sol.zones.map((z, i) => {
        const y1 = y(z.topOutletElevationM)
        const y2 = y(z.bottomOutletElevationM)
        const col = ZONE_FILL[i % ZONE_FILL.length]
        const st = z.station
        const yS = y(st.pumpCLElevationM)
        return (
          <g key={z.id}>
            <rect
              x={78}
              y={y1 - 3}
              width={64}
              height={Math.max(y2 - y1, 0) + 6}
              rx={3}
              fill={col}
              fillOpacity={z.feasible ? 0.3 : 0.15}
              stroke={z.feasible ? col : '#f59e0b'}
              strokeWidth={1.2}
              strokeDasharray={z.feasible ? undefined : '3 2'}
            />
            <text
              x={110}
              y={(y1 + y2) / 2 + 3}
              textAnchor="middle"
              fontSize={9}
              fontWeight={700}
              fill="#f5f5f5"
            >
              {z.id}
            </text>
            {st.kind !== 'pump-room' && (
              <line
                x1={st.kind === 'express' ? 66 : 150}
                x2={st.kind === 'express' ? 66 : 150}
                y1={yS}
                y2={y2}
                stroke={col}
                strokeWidth={2}
              />
            )}
            <rect
              x={st.kind === 'service-floor' ? 146 : 60}
              y={yS - 4}
              width={8}
              height={8}
              fill={col}
            />
            <text
              x={st.kind === 'service-floor' ? 158 : 60}
              y={st.kind === 'service-floor' ? yS + 3 : yS + 15}
              fontSize={7.5}
              fill="#d4d4d4"
              textAnchor={st.kind === 'service-floor' ? 'start' : 'middle'}
            >
              {st.kind === 'service-floor'
                ? 'break tank + pumps'
                : st.kind === 'express'
                  ? 'pump (express)'
                  : 'main pumps'}
            </text>
          </g>
        )
      })}
      {sol.kind === 'with-prv' && sol.prvCount > 0 && (
        <text x={110} y={top + H + 14} textAnchor="middle" fontSize={8} fill="#f59e0b">
          {sol.prvCount} PRV outlet(s) on the lower floors
        </text>
      )}
    </svg>
  )
}

const ZoneTable: React.FC<{ zones: StandpipeZone[]; floors: FloorLevel[] }> = ({
  zones,
  floors
}) => {
  const nm = (id: string): string => floors.find((fl) => fl.id === id)?.name ?? id
  return (
    <Table
      dense
      head={[
        'Zone',
        'Floors',
        'Station',
        'Req psi',
        'Rated psi',
        'Churn psi',
        'Max static',
        'Top resid.',
        'Tank m³'
      ]}
      rows={zones.map((z) => [
        <span key="z" className={z.feasible ? '' : 'text-amber-400'}>
          {z.id}
        </span>,
        z.floorIds.length > 1
          ? `${nm(z.floorIds[0])} - ${nm(z.floorIds[z.floorIds.length - 1])}`
          : nm(z.floorIds[0] ?? ''),
        z.station.kind === 'service-floor'
          ? `Service ${nm(z.station.floorId ?? '')}`
          : z.station.kind === 'express'
            ? `Express ${f(z.expressRiserLengthM ?? 0, 0)} m`
            : 'Pump room',
        f(z.requiredPressurePsi, 0),
        f(z.ratedNetPressurePsi, 0),
        f(z.churnDischargePsi, 0),
        <span key="s" className={z.maxStaticPsi > 175 ? 'text-amber-400' : ''}>
          {f(z.maxStaticPsi, 0)}
        </span>,
        f(z.topResidualPsi, 0),
        z.breakTank ? f(z.breakTank.volumeM3, 0) : '-'
      ])}
    />
  )
}

const SolutionCard: React.FC<{
  title: string
  sol: StandpipeSolution
  selected: boolean
  floors: FloorLevel[]
}> = ({ title, sol, selected, floors }) => (
  <div
    className={`bg-neutral-900 p-5 rounded-2xl flex flex-col gap-3 shadow-xl min-w-0 border ${selected ? 'border-emerald-600/70' : 'border-neutral-850'}`}
  >
    <div className="flex items-center gap-2 flex-wrap">
      <div className="text-xs font-bold text-neutral-200 uppercase tracking-wider">{title}</div>
      {selected && (
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-300 border border-emerald-600/50">
          SELECTED
        </span>
      )}
      <span
        className={`ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full border ${sol.feasible ? 'text-emerald-300 border-emerald-700/50' : 'text-amber-300 border-amber-600/60'}`}
      >
        {sol.feasible ? 'FEASIBLE' : 'NOT FEASIBLE'}
      </span>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-4">
      <KV
        rows={[
          ['Pressure zones', sol.zones.length],
          ['Fire pump sets', sol.pumpSets],
          ['PRVs', sol.prvCount],
          ['Express risers', sol.expressRisers],
          [
            'Service-floor stations',
            sol.serviceFloorStations.length
              ? sol.serviceFloorStations
                  .map((id) => floors.find((fl) => fl.id === id)?.name ?? id)
                  .join(', ')
              : 0
          ],
          ['Max static', `${f(sol.maxStaticPsi, 0)} psi`],
          ['Feasible', sol.feasible ? 'Yes' : 'No']
        ]}
      />
      <ZoningSchematic sol={sol} floors={floors} />
    </div>
    <ZoneTable zones={sol.zones} floors={floors} />
    <ul className="list-disc pl-4 flex flex-col gap-1 text-[11px] text-neutral-400 leading-relaxed">
      {sol.summary.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
    {sol.suggestion && (
      <div className="text-[11px] text-amber-200 bg-amber-950/30 border border-amber-600/50 rounded-xl px-3 py-2 leading-relaxed">
        <strong>Suggestion:</strong> {sol.suggestion}
      </div>
    )}
  </div>
)

export const StandpipeZoningPanel: React.FC<{
  study: StandpipeZoningStudy
  floors: FloorLevel[]
}> = ({ study, floors }) => (
  <div className="flex flex-col gap-3">
    <div className="text-xs font-bold text-neutral-300 uppercase tracking-wider">
      Standpipe zoning - with PRV vs without PRV
    </div>
    <div className="text-[11px] text-neutral-500">
      Strategy:{' '}
      {study.strategy === 'avoid' ? 'avoid PRVs (pressure zones)' : 'allow PRVs (single zone)'} ·
      service floors:{' '}
      {study.serviceFloorsAnswered
        ? study.serviceFloorIds.length
          ? study.serviceFloorIds
              .map((id) => floors.find((fl) => fl.id === id)?.name ?? id)
              .join(', ')
          : 'none'
        : 'not answered yet'}
    </div>
    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-5">
      <SolutionCard
        title="Without PRV (pressure zones)"
        sol={study.withoutPrv}
        selected={study.selected === 'without-prv'}
        floors={floors}
      />
      <SolutionCard
        title="With PRV (single zone)"
        sol={study.withPrv}
        selected={study.selected === 'with-prv'}
        floors={floors}
      />
    </div>
  </div>
)

// ───────────────────────── Pumps ─────────────────────────

export const PumpsPanel: React.FC<R> = ({ result }) => {
  const { pumps, demand } = result
  const sp = pumps.setpoints
  return (
    <div className="flex flex-col gap-5">
      <Card title="Pump schedule">
        <Table
          head={[
            'Tag',
            'Driver',
            'Role',
            'Type',
            'Rated flow',
            'Rated pressure',
            'RPM',
            'Churn psi',
            '150 % psi',
            'Max BHP',
            'Driver',
            'Suction / Discharge',
            'Relief'
          ]}
          rows={[
            ...pumps.mainPumps.map((p) => [
              p.tag,
              p.driver,
              p.role,
              p.pumpType,
              `${f(p.ratedFlowGpm, 0)} gpm / ${f(gpmToLpm(p.ratedFlowGpm), 0)} L/min`,
              `${f(p.ratedNetPressurePsi, 0)} psi / ${f(psiToBar(p.ratedNetPressurePsi), 1)} bar`,
              f(p.speedRpm, 0),
              f(p.churnPressurePsi, 1),
              f(p.pressureAt150Psi, 1),
              f(p.maxBhp, 1),
              `${f(p.driverHp, 0)} HP / ${f(p.driverKw, 0)} kW${p.dieselDeratePercent ? ` (derate ${f(p.dieselDeratePercent, 1)} %)` : ''}`,
              `${formatPipeSize(p.sizes.suctionIn)} / ${formatPipeSize(p.sizes.dischargeIn)}`,
              p.circulationReliefIn ? formatPipeSize(p.circulationReliefIn) : 'n/a'
            ]),
            [
              pumps.jockey.tag,
              'electric',
              'jockey',
              '-',
              `${f(pumps.jockey.ratedFlowGpm, 0)} gpm`,
              `${f(pumps.jockey.ratedNetPressurePsi, 0)} psi`,
              '-',
              '-',
              '-',
              '-',
              `${f(pumps.jockey.motorHp, 1)} HP`,
              formatPipeSize(pumps.jockey.pipeSizeIn),
              '-'
            ]
          ]}
        />
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card title="Pressure setpoints and system limits">
          <KV
            rows={[
              ['Jockey stop', `${f(sp.jockeyStopPsi, 1)} psi`],
              ['Jockey start', `${f(sp.jockeyStartPsi, 1)} psi`],
              ['Duty pump start', `${f(sp.dutyStartPsi, 1)} psi`],
              ['Standby pump start', `${f(sp.standbyStartPsi, 1)} psi`],
              [
                'Min run timer (electric / diesel)',
                `${sp.minRunTimerElectricMin} / ${sp.minRunTimerDieselMin} min`
              ],
              ['Min suction @ 150 %', `${f(pumps.suctionPressureMinPsi, 1)} psi`],
              ['Max static suction', `${f(pumps.maxStaticSuctionPsi, 1)} psi`],
              ['Suction velocity @ 150 %', `${f(pumps.suctionVelocityAt150Fps, 1)} fps`],
              [
                'Max system pressure',
                `${f(pumps.maxSystemPressurePsi, 1)} psi (${f(psiToBar(pumps.maxSystemPressurePsi), 1)} bar)`
              ],
              [
                'Test header',
                `${formatPipeSize(pumps.testHeaderIn)}, ${pumps.testHeaderHoseValves} hose valves`
              ],
              ['Flow meter', formatPipeSize(pumps.flowMeterIn)]
            ]}
          />
        </Card>
        <Card title="Pressure relief valve">
          <KV
            rows={[
              ['Required', pumps.mainReliefValve.required ? 'Yes' : 'No'],
              ['Valve size', formatPipeSize(pumps.mainReliefValve.sizeIn)],
              ['Discharge size', formatPipeSize(pumps.mainReliefValve.dischargeIn)],
              ['Set pressure', `${f(pumps.mainReliefValve.setPressurePsi, 1)} psi`]
            ]}
          />
          <p className="text-[11px] text-neutral-500 leading-relaxed">
            {pumps.mainReliefValve.reason}
          </p>
        </Card>
      </div>
      <Card title="Controllers">
        <Table
          head={['Tag', 'Kind', 'Description', 'Starting', 'Listing', 'W x D x H (mm)', 'Mounting']}
          rows={[...pumps.mainPumps.map((p) => p.controller), pumps.jockey.controller].map((c) => [
            c.tag,
            c.kind,
            c.description,
            c.startingMethod ?? '-',
            c.listing,
            `${c.widthMm} x ${c.depthMm} x ${c.heightMm}`,
            c.mounting
          ])}
        />
      </Card>
      {pumps.mainPumps.map((p) => (
        <PumpCurveChart
          key={p.tag}
          pump={p}
          demandFlowGpm={demand.pumpDemandFlowGpm}
          demandPressurePsi={demand.pumpDemandPressurePsi}
        />
      ))}
    </div>
  )
}

// ───────────────────────── Tank ─────────────────────────

export const TankPanel: React.FC<R> = ({ result }) => {
  const t = result.tank
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <Card title="Tank dimensions">
        <KV
          rows={[
            ['Material / placement', `${t.material} / ${t.placement}`],
            [
              'Required effective volume',
              `${f(t.requiredEffectiveM3, 1)} m³ (${f(t.requiredEffectiveGal, 0)} gal)`
            ],
            ['Provided effective volume', `${f(t.providedEffectiveM3, 1)} m³`],
            ['Compartments', t.compartments],
            ['Internal L x W', `${f(t.internalLengthM, 2)} x ${f(t.internalWidthM, 2)} m`],
            ['Effective depth', `${f(t.effectiveDepthM, 2)} m`],
            ['Total internal height', `${f(t.totalInternalHeightM, 2)} m`],
            ['Freeboard', `${f(t.freeboardM, 2)} m`],
            ['Overflow above effective', `${f(t.overflowAboveEffectiveM, 2)} m`],
            [
              'Wall / floor / roof',
              `${t.wallThicknessMm} / ${t.floorThicknessMm} / ${t.roofThicknessMm} mm`
            ],
            ['Refill time', `${f(t.refillHours, 1)} h`]
          ]}
        />
      </Card>
      <Card title="Water levels (above tank floor)">
        <KV
          rows={[
            ['Low water level', `${f(t.levels.lowWaterM, 2)} m`],
            ['Effective top', `${f(t.levels.effectiveTopM, 2)} m`],
            ['Overflow', `${f(t.levels.overflowM, 2)} m`],
            ['Top water level', `${f(t.levels.topWaterM, 2)} m`],
            ['Roof soffit', `${f(t.levels.roofSoffitM, 2)} m`]
          ]}
        />
      </Card>
      <Card title="Suction sump and vortex plate">
        <KV
          rows={[
            [
              'Suction pipe',
              `${formatPipeSize(t.sump.suctionPipeIn)} (OD ${f(t.sump.suctionPipeOdMm, 0)} mm)`
            ],
            ['Vortex plate', `${f(t.sump.vortexPlateMm, 0)} mm square`],
            ['Inlet above sump floor', `${f(t.sump.inletAboveSumpFloorMm, 0)} mm`],
            [
              'Pit L x W x D',
              `${f(t.sump.pitLengthMm, 0)} x ${f(t.sump.pitWidthMm, 0)} x ${f(t.sump.pitDepthMm, 0)} mm`
            ],
            ['Elbow drop', `${f(t.sump.elbowDropMm, 0)} mm`],
            ['Plate centre from wall', `${f(t.sump.plateCentreFromWallMm, 0)} mm`],
            ['Suction CL below tank floor', `${f(t.sump.suctionCLBelowTankFloorMm, 0)} mm`]
          ]}
        />
      </Card>
      <Card title="Connections">
        <Table
          head={['Connection', 'Size', 'Note']}
          rows={t.connections.map((c) => [c.name, formatPipeSize(c.sizeIn), c.note])}
        />
      </Card>
      <div className="xl:col-span-2">
        <Card title="Material specification">
          <ul className="list-disc pl-5 text-xs text-neutral-400 flex flex-col gap-1">
            {t.materialSpec.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

// ───────────────────────── Pump room ─────────────────────────

export const PumpRoomPanel: React.FC<R> = ({ result }) => {
  const r = result.room
  const e = r.elevations
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <Card title="Room dimensions">
        <KV
          rows={[
            ['Internal L x W', `${f(r.lengthMm / 1000, 2)} x ${f(r.widthMm / 1000, 2)} m`],
            ['Clear height', `${f(r.clearHeightMm / 1000, 2)} m`],
            ['Wall thickness', `${r.wallThicknessMm} mm`],
            ['Fire rating', `${r.fireRatingHours} h`],
            [
              'System outlet',
              `${formatPipeSize(r.systemOutlet.sizeIn)} at (${f(r.systemOutlet.x, 0)}, ${f(r.systemOutlet.y, 0)})`
            ]
          ]}
        />
      </Card>
      <Card title="Elevations (m, FFL = 0.00)">
        <KV
          rows={[
            ['Room floor', f(e.roomFloorM, 2)],
            ['Pad top', f(e.padTopM, 2)],
            ['Pump centre-line', f(e.pumpCLM, 2)],
            ['Tank floor', f(e.tankFloorM, 2)],
            ['High-level pipe', f(e.highLevelPipeM, 2)],
            ['Roof soffit', f(e.roofSoffitM, 2)]
          ]}
        />
      </Card>
      <div className="xl:col-span-2">
        <Card title="Equipment list">
          <Table
            head={['Tag', 'Kind', 'Label', 'X mm', 'Y mm', 'W mm', 'D mm', 'Pad']}
            rows={r.equipment.map((q) => [
              q.tag,
              q.kind,
              q.label,
              f(q.rect.x, 0),
              f(q.rect.y, 0),
              f(q.rect.w, 0),
              f(q.rect.h, 0),
              q.pad ? `${f(q.pad.w, 0)} x ${f(q.pad.h, 0)}` : '-'
            ])}
          />
        </Card>
      </div>
      <Card title="Drainage trench">
        <KV
          rows={[
            ['Width', `${r.trench.widthMm} mm`],
            [
              'Depth start / end',
              `${f(r.trench.depthStartMm, 0)} / ${f(r.trench.depthEndMm, 0)} mm`
            ],
            ['Slope', `${f(r.trench.slopePercent, 2)} %`],
            ['Length', `${f(r.trench.lengthMm, 0)} mm`],
            [
              'Capacity',
              `${f(r.trench.capacityGpm, 0)} gpm (${f(gpmToLpm(r.trench.capacityGpm), 0)} L/min)`
            ],
            ['Design inflow', `${f(r.trench.designInflowGpm, 0)} gpm`],
            ['Grating', r.trench.grating],
            [
              'Outlet pit',
              `${f(r.trench.outlet.pitMm, 0)} mm, drain ${formatPipeSize(r.trench.outlet.drainIn)}`
            ]
          ]}
        />
      </Card>
      <Card title="Doors and louvers">
        <Table
          head={['Item', 'Wall', 'Width mm', 'Purpose']}
          rows={[
            ...r.doors.map((d) => ['Door', d.wall, f(d.widthMm, 0), 'Access']),
            ...r.louvers.map((l) => ['Louver', l.wall, f(l.widthMm, 0), l.purpose])
          ]}
        />
      </Card>
    </div>
  )
}

// ───────────────────────── Checks ─────────────────────────

const STATUS_STYLE: Record<CheckStatus, { cls: string; icon: React.ReactNode }> = {
  pass: {
    cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    icon: <CheckCircle2 size={12} />
  },
  warn: {
    cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    icon: <AlertTriangle size={12} />
  },
  fail: { cls: 'bg-red-500/10 text-red-400 border-red-500/30', icon: <XCircle size={12} /> }
}

export const StatusChip: React.FC<{ status: CheckStatus }> = ({ status }) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${STATUS_STYLE[status].cls}`}
  >
    {STATUS_STYLE[status].icon}
    {status}
  </span>
)

export const ChecksPanel: React.FC<R> = ({ result }) => {
  const [filter, setFilter] = useState<CheckStatus | 'all'>('all')
  const counts = useMemo(() => {
    const c = { all: result.checks.length, pass: 0, warn: 0, fail: 0 }
    for (const k of result.checks) c[k.status]++
    return c
  }, [result.checks])
  const shown: DesignCheck[] = result.checks.filter((c) => filter === 'all' || c.status === filter)
  return (
    <Card title="Design checks">
      <div className="flex gap-2">
        {(['all', 'fail', 'warn', 'pass'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-3 py-1 rounded-lg text-[11px] font-bold uppercase cursor-pointer ${
              filter === k
                ? 'bg-red-600 text-white'
                : 'bg-neutral-950 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {k} ({counts[k]})
          </button>
        ))}
      </div>
      <div className="flex flex-col divide-y divide-neutral-850">
        {shown.length === 0 && (
          <div className="text-xs text-neutral-500 py-3">No checks in this category.</div>
        )}
        {shown.map((c) => (
          <div key={c.id} className="py-2.5 flex gap-3 items-start">
            <div className="pt-0.5 w-16 shrink-0">
              <StatusChip status={c.status} />
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="text-xs font-semibold text-neutral-200">{c.title}</div>
              <div className="text-[10px] text-orange-400/80 font-mono">{c.reference}</div>
              <div className="text-[11px] text-neutral-400 leading-relaxed">{c.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ───────────────────────── Report ─────────────────────────

export const ReportPanel: React.FC<R> = ({ result }) => {
  const text = useMemo(() => buildFireCalcReport(result), [result])
  return (
    <Card title="Calculation report">
      <div>
        <button
          onClick={() =>
            downloadText(`FP_${safeFileName(result.input.projectName)}_report.txt`, text)
          }
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-gradient-to-r from-red-600 to-orange-500 text-white cursor-pointer"
        >
          <Download size={13} /> Download .txt
        </button>
      </div>
      <pre className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-[10px] leading-snug text-neutral-300 font-mono overflow-auto max-h-[70vh] whitespace-pre">
        {text}
      </pre>
    </Card>
  )
}
