# Realistic CAD corpus (independent writer)

DXF files written by **ezdxf 1.4.4**, an independent DXF writer, plus `manifest.json` holding the **ground truth**.
The manifest is computed by `scripts/cad-corpus/generate_corpus.py` from the *construction geometry* (the rooms,
doors and columns the script draws). It is never produced from, or adjusted to, our own parser or recogniser output.

Regenerate (not part of `npm test`; the tests only read the committed files and never need Python):

```
pip install ezdxf==1.4.4        # pinned; the script refuses any other version
npm run corpus:generate         # = python3 scripts/cad-corpus/generate_corpus.py
```

Output is byte-stable (`write_fixed_meta_data_for_testing`, `PYTHONHASHSEED` pinned by the script, gzip mtime 0).
Tests: `src/renderer/src/engine/__tests__/cadRealisticCorpus.test.ts`.

## Files

| File | Version / units | What it exercises |
|---|---|---|
| `arch-metric-mm-r2018.dxf` | R2018, INSUNITS 4 (mm), MEASUREMENT 1 | Double-line walls (200 mm exterior, 100 mm interior) with jamb caps, `DOOR-SGL-900` blocks with ATTDEF/ATTRIB at rotations 0/90/180/270 and one mirrored (xscale -1), `WIN-1200` window blocks, 2 square 400 mm columns + one 450 mm circle, MTEXT room names `{\fArial\|b1;OFFICE 1}` with separate `CH 2700` / `C.H. = 2.70 m` notes, `A-AREA` boundaries (Office 1 4x5 m, Office 2, Corridor, Meeting 6x5 m) |
| `arch-imperial-in-r2010.dxf` | R2010, INSUNITS 1 (in), MEASUREMENT 0, LUNITS 4 | Single-line centreline walls in inches, rooms 12'x14' = 168 ft2 etc., rotated/mirrored door blocks, `CLG HT 9'-0"` and `CH 8'-6"` |
| `unitless-insunits0.dxf` | R2013, INSUNITS 0, MEASUREMENT 1 | Metric plan in mm without a unit declaration: expected confidence `unknown`, `units-unspecified` diagnostic, units must be user-confirmed |
| `noise-dim-hatch-spline-paper.dxf` | R2018, mm | Linear DIMENSIONs (`*D` blocks), solid + ANSI31 HATCH, SPLINE feature wall, ELLIPSE, XDATA, `Defpoints` POINTs, frozen + off layers, Layout1 title block (`TITLE BLOCK`, group 67) and a Layout2 with a VIEWPORT |
| `elevated-levels.dxf` | R2013, mm | Ground floor z=0 and second floor at z=3500 (LWPOLYLINE elevation 38, LINE z, INSERT z), one non-planar 3D LINE that must be dropped |
| `large-office-20k.dxf.gz` | R2018, mm | 48 office bays, 19,872 entities after block expansion (2.8 MB raw, 0.18 MB gzipped), desk/chair blocks, 240 `A-WALL` and 192 `A-AREA` segments (both far below the 5,000 limit on purpose) |
| `legacy-r2000-cp1252.dxf` | R2000, `$DWGCODEPAGE ANSI_1252` (read via `decodeDxfBytes`) | `Büro`, `Café` as cp1252 bytes and Arabic `ارتفاع السقف 2.80` written by ezdxf as `\U+XXXX` escapes |

Manifest conventions: coordinates are DXF drawing units with **Y up** (`parseDxfText` flips Y, the tests negate);
room areas are net ft2 of the *clear* room (centreline rectangle for the single-line imperial plan); door centre =
midpoint of hinge and latch, width = swing radius; `expectedEntityCount` is the number of LINE/LWPOLYLINE/CIRCLE/ARC/
ELLIPSE/TEXT/MTEXT entities after INSERT expansion, counted from the ezdxf document (ATTDEF/ATTRIB/SEQEND, DIMENSION,
HATCH, POINT, SPLINE and paper space excluded, hidden-layer entities included; ATTRIB is excluded by convention although the importer now draws each visible ATTRIB as a TEXT, and a SPLINE is excluded although it is now imported as a polyline, so the tests add them).

## Known gaps and Round 2 resolutions

No open gaps: all twelve defects the corpus found are fixed and their former `it.fails` tests are plain `it()` tests.
The `gap(...)` helper (`it.fails` unless `CORPUS_SHOW_GAPS=1`) is kept for future defects: declare the test with it,
and delete the row/test marker when the defect is fixed. The manifest was never edited to match importer output.
Documented behaviour changes that tests now assert:

- `$INSUNITS` / `$MEASUREMENT` are read (a code-2 value in HEADER is a variable value, not a section name).
- Top-level paper-space records (group 67 = 1) are skipped with one aggregated `PAPER_SPACE_SKIPPED` warning.
- A visible `ATTRIB` is imported as a TEXT (door tags `D01`...), `ATTDEF` templates / invisible attributes / `SEQEND` are dropped silently.
- Room names: MTEXT codes stripped, level notes (CH/CLG HT/FFL/FCL/SOFFIT), pure numbers and door/window tags ignored; the largest text wins, then the most central, then alphabetical.
- Room recognition collects eligible texts once and charges work per text examined: the 20k-entity plan gives 48 rooms.
- Path B: an approved opening closes every parallel face pair of a double-line wall (no jamb pockets), and faces with a mean width under 1 ft (wall bodies) are rejected with `wall-body-excluded`.
- `decodeDxfBytes` (used by `Toolbar.tsx`) decodes pre-R2007 files as `$DWGCODEPAGE` (windows-1252 default) and R2007+ as UTF-8; `\U+XXXX` escapes are decoded.
- SPLINE becomes an approximated LWPOLYLINE (de Boor for control points + knots, Catmull-Rom for fit points) with one `APPROXIMATED_GEOMETRY` warning; approximated geometry never feeds room recognition.
- Frozen (`70` bit 1) and off (negative colour) layers are imported but hidden by default (`DxfLayerInfo.sourceHidden`), kept out of snapping, room, opening and obstacle recognition until the user shows them. The manifest note ("hidden-layer entities included") still holds because they remain in `dxfEntities`.

Not defects (documented behaviour, asserted as such): DIMENSION (4), HATCH (2) and POINT (3) are reported once each as
`UNSUPPORTED_ENTITY`; XDATA, the second layout and its viewport are ignored without diagnostics.

## Measured performance (local, indicative)

| File | Entities | Parse | Store import (`setDxfData`) | Rooms (path A) |
|---|---|---|---|---|
| arch-metric-mm-r2018 | 90 | 8-13 ms | ~1 ms | ~0.5 ms |
| arch-imperial-in-r2010 | 34 | 2-3 ms | 0.3-1.2 ms | - |
| large-office-20k | 19,872 | ~250 ms | ~50-75 ms | ~8 ms (48 rooms) |

The test bounds are about 3x these numbers with a floor on the tiny ones.
