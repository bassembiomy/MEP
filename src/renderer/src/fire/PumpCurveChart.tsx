import React from 'react'
import type { FirePumpSelection } from '../engine/fireProtection/fpTypes'
import { gpmToLpm, psiToBar } from '../engine/fireProtection/hydraulics'

interface Props {
  pump: FirePumpSelection
  demandFlowGpm: number
  demandPressurePsi: number
}

const W = 640
const H = 380
const M = { l: 58, r: 20, t: 22, b: 50 }

function niceStep(range: number, target: number): number {
  const raw = range / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / mag
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag
}

export const PumpCurveChart: React.FC<Props> = ({ pump, demandFlowGpm, demandPressurePsi }) => {
  const pts = [...pump.curve].sort((a, b) => a.flowGpm - b.flowGpm)
  const rated = pump.ratedFlowGpm
  const ratedP = pump.ratedNetPressurePsi
  const lim65 = 0.65 * ratedP
  const lim140 = 1.4 * ratedP
  const xMaxRaw = Math.max(1.6 * rated, demandFlowGpm * 1.1, ...pts.map((p) => p.flowGpm))
  const yMaxRaw =
    Math.max(
      lim140,
      pump.churnPressurePsi,
      demandPressurePsi,
      ...pts.map((p) => p.netPressurePsi)
    ) * 1.05
  const xs = niceStep(xMaxRaw, 8)
  const ys = niceStep(yMaxRaw, 6)
  const xMax = Math.ceil(xMaxRaw / xs) * xs
  const yMax = Math.ceil(yMaxRaw / ys) * ys
  const X = (q: number): number => M.l + (q / xMax) * (W - M.l - M.r)
  const Y = (p: number): number => H - M.b - (p / yMax) * (H - M.t - M.b)

  const xTicks: number[] = []
  for (let v = 0; v <= xMax + 1e-6; v += xs) xTicks.push(v)
  const yTicks: number[] = []
  for (let v = 0; v <= yMax + 1e-6; v += ys) yTicks.push(v)

  const path = pts
    .map(
      (p, i) => `${i === 0 ? 'M' : 'L'}${X(p.flowGpm).toFixed(1)},${Y(p.netPressurePsi).toFixed(1)}`
    )
    .join(' ')
  const q150 = 1.5 * rated

  const marker = (
    q: number,
    p: number,
    color: string,
    label: string,
    dy: number,
    anchor: 'start' | 'end' = 'start'
  ): React.JSX.Element => (
    <g>
      <circle cx={X(q)} cy={Y(p)} r={5} fill={color} stroke="#0a0a0a" strokeWidth={1.5} />
      <text
        x={X(q) + (anchor === 'start' ? 9 : -9)}
        y={Y(p) + dy}
        fontSize={10}
        fill={color}
        textAnchor={anchor}
        fontWeight={700}
      >
        {label}
      </text>
    </g>
  )

  return (
    <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-3">
      <div className="text-[10px] font-bold text-neutral-400 uppercase mb-1">
        {pump.tag} - net pressure vs flow ({pump.driver})
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`${pump.tag} pump curve`}
      >
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={M.l} x2={W - M.r} y1={Y(v)} y2={Y(v)} stroke="#262626" />
            <text x={M.l - 6} y={Y(v) + 3} fontSize={10} fill="#a3a3a3" textAnchor="end">
              {v.toFixed(0)}
            </text>
            <text x={M.l - 6} y={Y(v) + 14} fontSize={8} fill="#525252" textAnchor="end">
              {psiToBar(v).toFixed(1)} bar
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <g key={`x${v}`}>
            <line x1={X(v)} x2={X(v)} y1={M.t} y2={H - M.b} stroke="#262626" />
            <text x={X(v)} y={H - M.b + 14} fontSize={10} fill="#a3a3a3" textAnchor="middle">
              {v.toFixed(0)}
            </text>
            <text x={X(v)} y={H - M.b + 25} fontSize={8} fill="#525252" textAnchor="middle">
              {gpmToLpm(v).toFixed(0)}
            </text>
          </g>
        ))}
        <rect
          x={M.l}
          y={M.t}
          width={W - M.l - M.r}
          height={H - M.t - M.b}
          fill="none"
          stroke="#525252"
        />
        <text
          x={(M.l + W - M.r) / 2}
          y={H - 8}
          fontSize={11}
          fill="#d4d4d4"
          textAnchor="middle"
          fontWeight={700}
        >
          Flow, gpm (L/min below)
        </text>
        <text
          transform={`translate(14 ${(M.t + H - M.b) / 2}) rotate(-90)`}
          fontSize={11}
          fill="#d4d4d4"
          textAnchor="middle"
          fontWeight={700}
        >
          Net pressure, psi (bar)
        </text>

        {/* 140 % churn limit and 65 % at 150 % flow limit */}
        <line
          x1={M.l}
          x2={W - M.r}
          y1={Y(lim140)}
          y2={Y(lim140)}
          stroke="#f59e0b"
          strokeDasharray="6 4"
        />
        <text x={W - M.r - 4} y={Y(lim140) - 4} fontSize={9} fill="#f59e0b" textAnchor="end">
          140 % of rated pressure (max churn)
        </text>
        <line
          x1={M.l}
          x2={W - M.r}
          y1={Y(lim65)}
          y2={Y(lim65)}
          stroke="#38bdf8"
          strokeDasharray="6 4"
        />
        <text x={W - M.r - 4} y={Y(lim65) - 4} fontSize={9} fill="#38bdf8" textAnchor="end">
          65 % of rated pressure (min @ 150 % flow)
        </text>
        <line
          x1={X(q150)}
          x2={X(q150)}
          y1={M.t}
          y2={H - M.b}
          stroke="#737373"
          strokeDasharray="2 4"
        />

        <path d={path} fill="none" stroke="#ef4444" strokeWidth={2.5} />

        {marker(
          0,
          pump.churnPressurePsi,
          '#fca5a5',
          `Churn ${pump.churnPressurePsi.toFixed(0)} psi`,
          -8
        )}
        {marker(
          rated,
          ratedP,
          '#f97316',
          `Rated ${rated.toFixed(0)} gpm @ ${ratedP.toFixed(0)} psi`,
          -10
        )}
        {marker(
          q150,
          pump.pressureAt150Psi,
          '#facc15',
          `150 % ${q150.toFixed(0)} gpm @ ${pump.pressureAt150Psi.toFixed(0)} psi`,
          -10,
          'end'
        )}
        {marker(
          demandFlowGpm,
          demandPressurePsi,
          '#22c55e',
          `Demand ${demandFlowGpm.toFixed(0)} gpm @ ${demandPressurePsi.toFixed(0)} psi`,
          18
        )}
      </svg>
    </div>
  )
}
