import type { FloorPlan } from '../engine/fireProtection/sprinkler/sprinklerTypes'

type Pt = [number, number]

export function underlayPath(plan: FloorPlan | null): string {
  if (!plan) return ''
  const f = (v: number): string => (Number.isFinite(v) ? v.toFixed(0) : '0')
  const d: string[] = []
  for (const e of plan.entities) {
    if (e.kind === 'line' && e.points.length >= 2) {
      d.push(`M${f(e.points[0][0])} ${f(e.points[0][1])}L${f(e.points[1][0])} ${f(e.points[1][1])}`)
    } else if (e.kind === 'polyline' && e.points.length >= 2) {
      d.push('M' + e.points.map((p) => `${f(p[0])} ${f(p[1])}`).join('L') + (e.closed ? 'Z' : ''))
    } else if (e.kind === 'circle' && e.radius && e.points[0]) {
      const [cx, cy] = e.points[0]
      const r = e.radius
      d.push(
        `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`
      )
    } else if (e.kind === 'arc' && e.radius && e.points[0]) {
      const [cx, cy] = e.points[0]
      const a0 = ((e.startDeg ?? 0) * Math.PI) / 180
      let a1 = ((e.endDeg ?? 360) * Math.PI) / 180
      if (a1 <= a0) a1 += 2 * Math.PI
      const n = Math.max(4, Math.ceil((a1 - a0) / (Math.PI / 12)))
      const pts: string[] = []
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n
        pts.push(`${f(cx + e.radius * Math.cos(a))} ${f(cy + e.radius * Math.sin(a))}`)
      }
      d.push('M' + pts.join('L'))
    }
  }
  return d.join('')
}

export const polyD = (pts: Pt[], close = false): string =>
  pts.length < 2
    ? ''
    : 'M' + pts.map((p) => `${p[0].toFixed(0)} ${p[1].toFixed(0)}`).join('L') + (close ? 'Z' : '')
