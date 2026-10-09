/**
 * Minimal ASCII DXF text builder for tests. Every function is pure and returns
 * a string of group-code/value pairs (one code line followed by one value line).
 */

type Pair = [code: number, value: string | number];

const records = (...pairs: Pair[]): string =>
  pairs.map(([code, value]) => `${code}\n${value}`).join('\n');

const section = (name: string, body: string[]): string =>
  [records([0, 'SECTION'], [2, name]), ...body, records([0, 'ENDSEC'])].join('\n');

export interface HeaderOptions {
  insunits?: number;
  measurement?: 0 | 1;
}

/** HEADER section. Only the variables that were supplied are written. */
export function header(options: HeaderOptions = {}): string {
  const body: string[] = [];
  if (options.insunits !== undefined) {
    body.push(records([9, '$INSUNITS'], [70, options.insunits]));
  }
  if (options.measurement !== undefined) {
    body.push(records([9, '$MEASUREMENT'], [70, options.measurement]));
  }
  return section('HEADER', body);
}

/** LAYER table entry (default color 7, CONTINUOUS linetype). */
export function layer(name: string): string {
  return records([0, 'LAYER'], [2, name], [70, 0], [62, 7], [6, 'CONTINUOUS']);
}

export function line(layerName: string, x1: number, y1: number, x2: number, y2: number): string {
  return records(
    [0, 'LINE'], [8, layerName],
    [10, x1], [20, y1], [11, x2], [21, y2]
  );
}

/** LWPOLYLINE with planar vertices. `closed` sets the closed flag (70 bit 1). */
export function lwpolyline(
  layerName: string,
  points: [number, number][],
  closed = false
): string {
  const pairs: Pair[] = [
    [0, 'LWPOLYLINE'], [8, layerName],
    [90, points.length], [70, closed ? 1 : 0]
  ];
  for (const [x, y] of points) pairs.push([10, x], [20, y]);
  return records(...pairs);
}

/** ARC with angles in degrees (counter-clockwise, as DXF defines them). */
export function arc(
  layerName: string,
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): string {
  return records(
    [0, 'ARC'], [8, layerName],
    [10, cx], [20, cy], [40, r], [50, startDeg], [51, endDeg]
  );
}

export function circle(layerName: string, cx: number, cy: number, r: number): string {
  return records([0, 'CIRCLE'], [8, layerName], [10, cx], [20, cy], [40, r]);
}

export function text(layerName: string, x: number, y: number, height: number, value: string): string {
  return records([0, 'TEXT'], [8, layerName], [10, x], [20, y], [40, height], [1, value]);
}

export function mtext(layerName: string, x: number, y: number, height: number, value: string): string {
  return records([0, 'MTEXT'], [8, layerName], [10, x], [20, y], [40, height], [1, value]);
}

/** BLOCK definition (base point 0,0) containing the given entity strings. */
export function block(name: string, entities: string): string {
  const body = entities ? [entities] : [];
  return [
    records([0, 'BLOCK'], [8, '0'], [2, name], [70, 0], [10, 0], [20, 0]),
    ...body,
    records([0, 'ENDBLK'], [8, '0'])
  ].join('\n');
}

export interface InsertOptions {
  rotation?: number;
  sx?: number;
  sy?: number;
}

export function insert(
  layerName: string,
  name: string,
  x: number,
  y: number,
  options: InsertOptions = {}
): string {
  const { rotation = 0, sx = 1, sy = 1 } = options;
  return records(
    [0, 'INSERT'], [8, layerName], [2, name],
    [10, x], [20, y], [41, sx], [42, sy], [50, rotation]
  );
}

export interface DxfParts {
  header?: string;
  layers: string[];
  blocks: string[];
  entities: string[];
}

/** Assembles HEADER, TABLES (LAYER table), BLOCKS, ENTITIES and EOF into one DXF string. */
export function dxf({ header: headerSection = header(), layers, blocks, entities }: DxfParts): string {
  const tables = section('TABLES', [
    records([0, 'TABLE'], [2, 'LAYER'], [70, layers.length]),
    ...layers,
    records([0, 'ENDTAB'])
  ]);
  const blocksSection = section('BLOCKS', blocks);
  const entitiesSection = section('ENTITIES', entities);
  return `${[headerSection, tables, blocksSection, entitiesSection].join('\n')}\n${records([0, 'EOF'])}\n`;
}
