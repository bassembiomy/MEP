/**
 * Synthetic architectural floor plan (DXF text, $INSUNITS = millimetres) for the "Load sample floor" demo:
 * an open office, a storage room and a corridor on layer A-ROOM with text labels, plus walls and a door block.
 */
export function buildSampleFloorDxf(): string {
  const out: string[] = []
  const g = (code: number, value: string | number): void => {
    out.push(String(code).padStart(3, ' '), String(value))
  }
  const rect = (layer: string, x0: number, y0: number, x1: number, y1: number): void => {
    g(0, 'LWPOLYLINE')
    g(8, layer)
    g(90, 4)
    g(70, 1)
    for (const [x, y] of [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1]
    ]) {
      g(10, x)
      g(20, y)
    }
  }
  const text = (x: number, y: number, h: number, s: string): void => {
    g(0, 'TEXT')
    g(8, 'A-TEXT')
    g(10, x)
    g(20, y)
    g(40, h)
    g(1, s)
  }
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number): void => {
    g(0, 'LINE')
    g(8, layer)
    g(10, x1)
    g(20, y1)
    g(11, x2)
    g(21, y2)
  }
  g(0, 'SECTION')
  g(2, 'HEADER')
  g(9, '$INSUNITS')
  g(70, 4)
  g(0, 'ENDSEC')
  g(0, 'SECTION')
  g(2, 'ENTITIES')
  rect('A-WALL', -300, -300, 31000, 15000)
  rect('A-ROOM', 0, 0, 20000, 12000) // open office
  rect('A-ROOM', 22000, 0, 30000, 6000) // storage
  rect('A-ROOM', 0, 12500, 30000, 14500) // corridor
  line('A-WALL', 20000, 0, 20000, 12000)
  line('A-WALL', 21000, 0, 21000, 12000)
  line('A-WALL', 21000, 6000, 31000, 6000)
  text(8000, 6000, 300, 'OPEN OFFICE')
  text(8300, 5400, 150, 'R-101')
  text(25000, 3000, 300, 'STORAGE ROOM')
  text(12000, 13300, 300, 'CORRIDOR')
  g(0, 'ENDSEC')
  g(0, 'EOF')
  return out.join('\r\n') + '\r\n'
}
