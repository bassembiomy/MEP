import React, { useState, useEffect } from 'react';
import { useProjectStore } from '../../store/projectStore';
import {
  ExternalLink,
  ShieldCheck,
  Layers,
  Gauge,
  CheckCircle2,
  X
} from 'lucide-react';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  entityType: 'zone' | 'task' | 'requirement' | 'simulation';
  entityId: string;
  title: string;
}

export const ContextMenuManager: React.FC = () => {
  const store = useProjectStore() as any;
  const selectZone = store.selectZone;

  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('[data-context-entity]');
      if (target) {
        e.preventDefault();
        const type = target.getAttribute('data-context-type') as ContextMenuState['entityType'];
        const id = target.getAttribute('data-context-id') || '';
        const title = target.getAttribute('data-context-title') || id;

        setMenu({
          visible: true,
          x: Math.min(window.innerWidth - 220, e.clientX),
          y: Math.min(window.innerHeight - 200, e.clientY),
          entityType: type || 'zone',
          entityId: id,
          title
        });
      } else {
        setMenu(null);
      }
    };

    const handleClick = () => setMenu(null);

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('click', handleClick);
    };
  }, []);

  if (!menu || !menu.visible) return null;

  const handleOpenFloating = () => {
    const windowType = menu.entityType === 'zone' ? 'cad-object' : (menu.entityType as any);
    store.openFloatingWindow?.({
      id: `win-${menu.entityType}-${menu.entityId}`,
      title: `${menu.entityType.toUpperCase()}: ${menu.title}`,
      type: windowType,
      entityId: menu.entityId
    });
    setMenu(null);
  };

  const handleOpenCad = () => {
    store.setActivePerspective?.('hvac');
    if (menu.entityType === 'zone' && selectZone) {
      selectZone(menu.entityId);
    }
    setMenu(null);
  };

  const handleOpenReq = () => {
    store.openFloatingWindow?.({
      id: `win-req-REQ-HVAC-014`,
      title: 'Requirement: REQ-HVAC-014',
      type: 'requirement',
      entityId: 'REQ-HVAC-014'
    });
    setMenu(null);
  };

  const handleRunSolver = () => {
    store.executeAerodynamicSolverRun?.(menu.entityId);
    store.openFloatingWindow?.({
      id: 'win-sim-101',
      title: 'Simulation Analysis: SIM-101',
      type: 'simulation',
      entityId: 'SIM-101'
    });
    setMenu(null);
  };

  return (
    <div
      style={{ left: menu.x, top: menu.y }}
      className="fixed z-50 bg-neutral-900 border border-neutral-750 rounded-2xl shadow-2xl p-1.5 flex flex-col gap-1 w-56 text-xs text-neutral-200 select-none animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-2.5 py-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-800 flex items-center justify-between">
        <span className="truncate max-w-[160px]">{menu.title}</span>
        <button onClick={() => setMenu(null)} className="text-neutral-500 hover:text-neutral-300">
          <X size={12} />
        </button>
      </div>

      <button
        onClick={handleOpenFloating}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-blue-600 hover:text-white transition-colors cursor-pointer text-left font-semibold"
      >
        <ExternalLink size={13} />
        <span>Open Details Window</span>
      </button>

      {menu.entityType === 'zone' && (
        <>
          <button
            onClick={handleOpenCad}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-teal-600 hover:text-white transition-colors cursor-pointer text-left"
          >
            <Layers size={13} />
            <span>Select in CAD Canvas</span>
          </button>
          <button
            onClick={handleRunSolver}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-cyan-600 hover:text-white transition-colors cursor-pointer text-left"
          >
            <Gauge size={13} />
            <span>Run Static Pressure Test</span>
          </button>
        </>
      )}

      {menu.entityType === 'task' && (
        <>
          <button
            onClick={handleOpenCad}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-teal-600 hover:text-white transition-colors cursor-pointer text-left"
          >
            <Layers size={13} />
            <span>Open in HVAC Workspace</span>
          </button>
          <button
            onClick={() => {
              store.updateTask?.(menu.entityId, { progress: 100, status: 'completed' });
              setMenu(null);
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-emerald-600 hover:text-white transition-colors cursor-pointer text-left text-emerald-400"
          >
            <CheckCircle2 size={13} />
            <span>Mark Task Completed</span>
          </button>
        </>
      )}

      <button
        onClick={handleOpenReq}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-purple-600 hover:text-white transition-colors cursor-pointer text-left"
      >
        <ShieldCheck size={13} />
        <span>View Linked Requirements</span>
      </button>
    </div>
  );
};
