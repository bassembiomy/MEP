import { create } from 'zustand';
import type { EquipmentCatalogItem } from '../engine/types';
import { STANDARD_EQUIPMENT_CATALOG, setEquipmentCatalogProvider } from '../engine/hvacCatalogs';

export interface ImportedCatalog {
  id: string;
  name: string;
  importedAt: number;
  enabled: boolean;
  entries: EquipmentCatalogItem[];
}

interface PersistedShape {
  catalogs: ImportedCatalog[];
  useGenericEntries: boolean;
}

const STORAGE_KEY = 'mep.equipmentCatalogs.v1';

/** Pure: built-in (minus generic if disabled) + enabled imported entries; imported override built-in by model. */
export function computeActiveCatalog(
  catalogs: ImportedCatalog[],
  useGenericEntries: boolean,
  builtIn: EquipmentCatalogItem[] = STANDARD_EQUIPMENT_CATALOG
): EquipmentCatalogItem[] {
  const byModel = new Map<string, EquipmentCatalogItem>();
  const order: string[] = [];
  const put = (e: EquipmentCatalogItem): void => {
    const k = e.model.trim().toLowerCase();
    if (!byModel.has(k)) order.push(k);
    byModel.set(k, e);
  };
  for (const e of builtIn) if (useGenericEntries || !e.isGeneric) put(e);
  for (const c of catalogs) if (c.enabled) for (const e of c.entries) put(e);
  return order.map((k) => byModel.get(k)!);
}

function load(): PersistedShape {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const p = JSON.parse(raw) as Partial<PersistedShape>;
      return {
        catalogs: Array.isArray(p.catalogs) ? p.catalogs : [],
        useGenericEntries: p.useGenericEntries !== false
      };
    }
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return { catalogs: [], useGenericEntries: true };
}

function save(s: PersistedShape): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ catalogs: s.catalogs, useGenericEntries: s.useGenericEntries }));
    }
  } catch {
    /* quota / unavailable: keep in-memory state only */
  }
}

interface CatalogState extends PersistedShape {
  addCatalog: (name: string, entries: EquipmentCatalogItem[]) => string;
  removeCatalog: (id: string) => void;
  setCatalogEnabled: (id: string, enabled: boolean) => void;
  setUseGenericEntries: (v: boolean) => void;
}

export const useCatalogStore = create<CatalogState>((set, get) => {
  const persist = (): void => save(get());
  return {
    ...load(),
    addCatalog: (name, entries) => {
      const id = `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      set((s) => ({ catalogs: [...s.catalogs, { id, name, importedAt: Date.now(), enabled: true, entries }] }));
      persist();
      return id;
    },
    removeCatalog: (id) => {
      set((s) => ({ catalogs: s.catalogs.filter((c) => c.id !== id) }));
      persist();
    },
    setCatalogEnabled: (id, enabled) => {
      set((s) => ({ catalogs: s.catalogs.map((c) => (c.id === id ? { ...c, enabled } : c)) }));
      persist();
    },
    setUseGenericEntries: (v) => {
      set({ useGenericEntries: v });
      persist();
    }
  };
});

/** Active equipment catalog = built-in (minus generic if disabled) + enabled imported entries. */
export function getActiveEquipmentCatalog(): EquipmentCatalogItem[] {
  const s = useCatalogStore.getState();
  return computeActiveCatalog(s.catalogs, s.useGenericEntries);
}

// Install as the engine's catalog provider on load.
setEquipmentCatalogProvider(getActiveEquipmentCatalog);
