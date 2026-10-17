import React, { useMemo, useRef, useState } from 'react';
import { ModalPortal } from './ModalPortal';
import { useProjectStore, type Zone } from '../store/projectStore';
import { isImperial } from '../engine/units';
import {
  buildSections,
  dimText,
  levelLabel,
  type Section,
  type SectionElementType
} from '../engine/sections/sectionBuilder';

interface Props {
  zone: Zone;
  onClose: () => void;
}

/** Standard drawing scale: 1/4"=1'-0" (imperial) / ~1:50 (metric) -> ~24 px per ft. */
const PX_FT = 24;
const MARGIN_L = 150;
const MARGIN_R = 150;
const MARGIN_T = 50;
const MARGIN_B = 70;

const FILL: Record<SectionElementType, { fill: string; stroke: string }> = {
  slab: { fill: '#52525b', stroke: '#a1a1aa' },
  structure: { fill: 'rgba(120,113,108,0.12)', stroke: 'none' },
  ceiling: { fill: '#38bdf8', stroke: '#7dd3fc' },
  unit: { fill: '#a78bfa55', stroke: '#a78bfa' },
  trunk: { fill: '#3b82f655', stroke: '#60a5fa' },
  branch: { fill: '#14b8a655', stroke: '#2dd4bf' },
  crossing: { fill: '#f59e0b55', stroke: '#fbbf24' },
  neck: { fill: '#22c55e44', stroke: '#4ade80' }
};

const SectionSvg = React.forwardRef<SVGSVGElement, { s: Section; units: string }>(({ s, units }, ref) => {
  const W = s.length * PX_FT + MARGIN_L + MARGIN_R;
  const zTop = s.levels.slabTop + 0.6;
  const H = zTop * PX_FT + MARGIN_T + MARGIN_B;
  const X = (x: number): number => MARGIN_L + x * PX_FT;
  const Y = (z: number): number => MARGIN_T + (zTop - z) * PX_FT;
  const lv = s.levels;
  const bad = new Set(s.issues.filter((i) => i.severity === 'error').map((i) => i.ductId));
  const warn = new Set(s.issues.filter((i) => i.severity === 'warning').map((i) => i.ductId));
  const trunk = s.elements.find((e) => e.type === 'trunk') ?? s.elements.find((e) => e.type === 'branch' || e.type === 'crossing');
  const dims: { z0: number; z1: number; text: string }[] = [
    { z0: lv.ffl, z1: lv.ceiling, text: `FFL-CLG ${dimText(lv.ceiling - lv.ffl, units)}` },
    ...(trunk
      ? [
          { z0: lv.ceiling, z1: trunk.z0, text: `CLG-BOD ${dimText(trunk.z0 - lv.ceiling, units)}` },
          { z0: trunk.z1, z1: lv.slabUnderside, text: `TOP-SLAB ${dimText(lv.slabUnderside - trunk.z1, units)}` }
        ]
      : [{ z0: lv.ceiling, z1: lv.slabUnderside, text: `VOID ${dimText(lv.slabUnderside - lv.ceiling, units)}` }])
  ];
  const levels: [string, number][] = [
    ['FFL', lv.ffl],
    ['CEILING', lv.ceiling],
    ['SLAB', lv.slabUnderside]
  ];
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily="monospace">
      <rect width={W} height={H} fill="#0a0a0a" />
      <text x={MARGIN_L} y={26} fill="#e5e5e5" fontSize={14} fontWeight="bold">{s.title}</text>
      <text x={MARGIN_L + 330} y={26} fill="#737373" fontSize={11}>{isImperial(units) ? "SCALE 1/4\" = 1'-0\"" : 'SCALE 1:50'}</text>
      {/* FFL line */}
      <line x1={MARGIN_L - 20} x2={X(s.length) + 20} y1={Y(lv.ffl)} y2={Y(lv.ffl)} stroke="#a3a3a3" strokeWidth={2} />
      {s.elements.map((e, i) => {
        const st = FILL[e.type];
        const isBad = e.id !== undefined && bad.has(e.id) && (e.type === 'trunk' || e.type === 'branch' || e.type === 'crossing');
        const isWarn = !isBad && e.id !== undefined && warn.has(e.id) && (e.type === 'trunk' || e.type === 'branch' || e.type === 'crossing');
        const x = X(e.x0);
        const y = Y(e.z1);
        const w = Math.max(1, (e.x1 - e.x0) * PX_FT);
        const h = Math.max(1, (e.z1 - e.z0) * PX_FT);
        const stroke = isBad ? '#ef4444' : isWarn ? '#f59e0b' : st.stroke;
        const duct = e.type === 'trunk' || e.type === 'branch' || e.type === 'crossing';
        return (
          <g key={`${e.type}-${e.id ?? ''}-${i}`}>
            <rect x={x} y={y} width={w} height={h} fill={isBad ? '#ef444455' : st.fill} stroke={stroke} strokeWidth={isBad ? 2 : 1} />
            {e.cut && (e.type !== 'neck') && <path d={`M${x} ${y} L${x + w} ${y + h} M${x + w} ${y} L${x} ${y + h}`} stroke={stroke} strokeWidth={1} />}
            {duct && e.label && (
              <text x={x + w / 2} y={y - 3} fill={isBad ? '#fca5a5' : '#d4d4d4'} fontSize={9} textAnchor="middle">{e.label}</text>
            )}
            {(e.type === 'unit' || e.type === 'slab') && e.label && (
              <text x={e.type === 'slab' ? X(s.length) + 6 : x + w / 2} y={e.type === 'slab' ? y + h / 2 + 3 : y + h / 2 + 3} fill="#d4d4d4" fontSize={9} textAnchor={e.type === 'slab' ? 'start' : 'middle'}>{e.label}</text>
            )}
          </g>
        );
      })}
      {/* levels */}
      {levels.map(([n, z]) => (
        <g key={n}>
          <line x1={MARGIN_L - 10} x2={X(s.length) + 10} y1={Y(z)} y2={Y(z)} stroke="#525252" strokeDasharray="6 4" />
          <text x={8} y={Y(z) - 3} fill="#fbbf24" fontSize={10}>{levelLabel(n, z, units)}</text>
        </g>
      ))}
      {/* dimension strings */}
      {dims.map((d, i) => (
        <g key={i} stroke="#38bdf8" fill="#7dd3fc">
          <line x1={MARGIN_L - 40 - (i % 2) * 20} x2={MARGIN_L - 40 - (i % 2) * 20} y1={Y(d.z0)} y2={Y(d.z1)} strokeWidth={1} />
          <line x1={MARGIN_L - 46} x2={MARGIN_L - 34} y1={Y(d.z0)} y2={Y(d.z0)} />
          <line x1={MARGIN_L - 46} x2={MARGIN_L - 34} y1={Y(d.z1)} y2={Y(d.z1)} />
          <text x={X(s.length) + 14} y={(Y(d.z0) + Y(d.z1)) / 2 + 3 + (i === 0 ? 0 : 0)} fontSize={9} stroke="none">{d.text}</text>
        </g>
      ))}
    </svg>
  );
});
SectionSvg.displayName = 'SectionSvg';

export const SectionViewModal: React.FC<Props> = ({ zone, onClose }) => {
  const project = useProjectStore((st) => st.project);
  const units = project.units;
  const sections = useMemo(() => buildSections(zone, { scale: project.scale, units }), [zone, project.scale, units]);
  const [sel, setSel] = useState(sections[0]?.id ?? '');
  const svgRef = useRef<SVGSVGElement>(null);
  const cur = sections.find((s) => s.id === sel) ?? sections[0];

  const exportPng = (): void => {
    const svg = svgRef.current;
    if (!svg || !cur) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = svg.width.baseVal.value * 2;
      c.height = svg.height.baseVal.value * 2;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      const a = document.createElement('a');
      a.download = `${zone.name || 'zone'}-section-${cur.label}.png`.replace(/\s+/g, '_');
      a.href = c.toDataURL('image/png');
      a.click();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  };

  return (
    <ModalPortal onClose={onClose} widthClass="max-w-6xl" className="bg-neutral-950 border border-neutral-800" label="Duct sections">
      <div className="p-5 flex flex-col gap-4 text-neutral-200">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wider">Duct Sections - {zone.name}</h2>
          <div className="flex gap-2">
            <button onClick={exportPng} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white cursor-pointer">Export PNG</button>
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-neutral-900 border border-neutral-800 cursor-pointer">Close</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setSel(s.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer border ${
                cur?.id === s.id ? 'bg-blue-600 border-blue-500 text-white' : 'bg-neutral-900 border-neutral-800 text-neutral-400'
              }`}
            >
              {s.label} {s.kind === 'transverse' ? 'Transverse' : `Trunk${s.unitId ? ` ${s.unitId}` : ''}`}
              {s.issues.some((i) => i.severity === 'error') ? ' !' : ''}
            </button>
          ))}
        </div>
        {cur ? (
          <>
            <div className="overflow-auto border border-neutral-800 rounded-xl bg-neutral-950">
              <SectionSvg ref={svgRef} s={cur} units={units} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="font-bold uppercase text-neutral-400 mb-1">Legend / Cut lines</div>
                <ul className="text-neutral-400 flex flex-col gap-0.5">
                  {sections.map((s) => (
                    <li key={s.id}>
                      <span className="font-mono text-neutral-200">{s.label}</span> {s.kind === 'transverse' ? 'transverse through unit' : 'along unit trunk'}
                      {' - '}
                      {Math.round(s.length * (isImperial(units) ? 1 : 0.3048) * 100) / 100} {isImperial(units) ? 'ft' : 'm'}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-neutral-500">Void {dimText(cur.voidIn / 12, units)}; slab {dimText(0.5, units)}; unit 10&quot; ducted FCU.</div>
              </div>
              <div>
                <div className="font-bold uppercase text-neutral-400 mb-1">Issues ({cur.issues.length})</div>
                {cur.issues.length === 0 ? (
                  <div className="text-emerald-400">No clashes in this section.</div>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {cur.issues.map((i, n) => (
                      <li key={n} className={`rounded px-2 py-1 border ${i.severity === 'error' ? 'bg-red-950/50 border-red-700 text-red-300' : 'bg-amber-950/40 border-amber-700 text-amber-300'}`}>
                        {i.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="text-neutral-500 text-sm">No section data for this zone.</div>
        )}
      </div>
    </ModalPortal>
  );
};
