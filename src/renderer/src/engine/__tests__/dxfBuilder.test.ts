import { describe, expect, it } from 'vitest';
import { parseDxfText } from '../dxfParser';
import {
  block,
  dxf,
  header,
  insert,
  layer,
  line,
  lwpolyline,
  text
} from './fixtures/dxfBuilder';

describe('dxfBuilder fixture', () => {
  it('round-trips a small drawing through parseDxfText', () => {
    const blockDef = block('FAN', line('0', 0, 0, 1000, 0));
    const source = dxf({
      header: header({ insunits: 4 }),
      layers: [layer('0'), layer('ROOMS'), layer('NOTES')],
      blocks: [blockDef],
      entities: [
        lwpolyline('ROOMS', [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], true),
        line('ROOMS', 0, 0, 5000, 0),
        text('NOTES', 100, 200, 150, 'OFFICE'),
        insert('EQUIP', 'FAN', 5000, 5000, { rotation: 90 })
      ]
    });

    const parsed = parseDxfText(source);

    expect(parsed.diagnostics ?? []).toEqual([]);
    expect(parsed.insUnits).toBe(4);
    expect(parsed.cadUnit).toBe('mm');
    expect(parsed.unitsConfidence).toBe('declared');

    expect(parsed.entities.map(e => e.type).sort()).toEqual(
      ['LINE', 'LINE', 'LWPOLYLINE', 'TEXT']
    );

    const polyline = parsed.entities.find(e => e.type === 'LWPOLYLINE');
    expect(polyline?.closed).toBe(true);
    expect(polyline?.layer).toBe('ROOMS');
    expect(polyline?.points).toHaveLength(8);

    const text0 = parsed.entities.find(e => e.type === 'TEXT');
    expect(text0?.text).toBe('OFFICE');
    expect(text0?.layer).toBe('NOTES');

    // Block geometry from the INSERT inherits the INSERT layer (block layer 0).
    const fanLine = parsed.entities.find(e => e.type === 'LINE' && e.sourceBlock === 'FAN');
    expect(fanLine?.layer).toBe('EQUIP');
    expect(fanLine?.x).toBeCloseTo(5000);
    expect(fanLine?.y).toBeCloseTo(-5000);
    // Rotation 90 degrees maps the block's +X end onto +Y (drawn downward in parser space).
    expect(fanLine?.points?.[0]).toBeCloseTo(5000);
    expect(fanLine?.points?.[1]).toBeCloseTo(-6000);
  });
});
