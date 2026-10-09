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
| `legacy-r2000-cp1252.dxf` | R2000, `$DWGCODEPAGE ANSI_1252` | `Büro`, `Café` as cp1252 bytes and Arabic `ارتفاع السقف 2.80` written by ezdxf as `\U+XXXX` escapes |

Manifest conventions: coordinates are DXF drawing units with **Y up** (`parseDxfText` flips Y, the tests negate);
room areas are net ft2 of the *clear* room (centreline rectangle for the single-line imperial plan); door centre =
midpoint of hinge and latch, width = swing radius; `expectedEntityCount` is the number of LINE/LWPOLYLINE/CIRCLE/ARC/
ELLIPSE/TEXT/MTEXT entities after INSERT expansion, counted from the ezdxf document (ATTDEF/ATTRIB/SEQEND, DIMENSION,
HATCH, POINT, SPLINE and paper space excluded, hidden-layer entities included).

## Known gaps

Every row is a real defect the corpus found. Its assertion is an `it.fails(...)` ("KNOWN GAP: ..." in the test title),
so the suite is green today and goes **red when the defect is fixed**; whoever fixes it must turn that test into a
plain `it()`, delete the row, and keep the manifest unchanged. `CORPUS_SHOW_GAPS=1 npx vitest run cadRealisticCorpus`
runs the gaps as normal tests and prints the real assertion failures.

| # | Gap | Evidence (measured) | Tests (`it.fails`) | Likely fix site (Round 2) |
|---|---|---|---|---|
| 2 | ATTRIB, ATTDEF and SEQEND are reported as `UNSUPPORTED_ENTITY` warnings | metric + imperial: 15 each (5 ATTDEF per expanded INSERT, 5 ATTRIB, 5 SEQEND) | `INSERT attributes ...` (metric, imperial) | `dxfParser.ts` default case |
| 3 | Room names are the alphabetically-first raw interior text: MTEXT formatting codes and `CH` notes leak into the name | Office 1 is named `CH 2700` (expected `OFFICE 1`); imperial Office A is `CLG HT 9'-0"`; raw `{\fArial\|b1;OFFICE 1}` also present in the label list | `room names come from the raw ...` (metric, imperial) | `roomRecognition.ts` label loop (normalise MTEXT, ignore level annotations) |
| 4 | Path B (user-confirmed `A-WALL`, approved openings): an approved opening closes its gap on whichever wall face its end snaps to, so the Corridor polygon swallows jamb pockets | Corridor 309.57 ft2 vs ground truth 305.70 ft2 (+1.27%, limit 0.5%); the three other rooms are exact | `an approved opening closes the gap ...` | `roomRecognition.ts` approved-opening snap |
| 5 | Path B: the body of a double-line wall (between its two face lines) is returned as a room candidate | 5 candidates for 4 rooms; extra `Room`, 33.8 ft2, 8 vertices; 8 smaller boundaries were already suppressed by the 20 ft2 threshold | `the 200 mm double-line exterior wall body ...` | `roomRecognition.ts` face filtering |
| 6 | SPLINE is unsupported, so a curved feature wall is dropped | 1 `UNSUPPORTED_ENTITY:SPLINE`, 0 entities on `A-WALL-CURVE` | `SPLINE feature wall is dropped ...` | `dxfParser.ts` (sample to polyline) |
| 7 | Paper-space entities (group 67) are imported into the model | Layout1 title block: 4 LINEs + TEXT `TITLE BLOCK` become model entities (90 vs 85 expected) | `paper-space (group 67) ...`, and the entity-count test in the noise file | `dxfParser.ts` `expand()` (skip group 67 = 1) |
| 8 | Frozen / off layers are imported as visible geometry | 2 entities from `A-FRZ` (frozen) and `A-OFF` (off) are present | `geometry on frozen / off layers ...` | `dxfParser.ts` layer table (group 70 bit 1, negative colour); design question: hide or import-but-hidden |
| 9 | Room recognition on a ~20k-entity plan exhausts the 200,000 work budget in the label loop (rooms x all entities) and returns 0 candidates | 19,872 entities, 48 closed `A-AREA` boundaries: `recognition-budget-exceeded`, 0 rooms in ~8 ms. The same 48 boundaries alone (192 entities) give 48 correct rooms (passing evidence test) | `room recognition on a ~20k-entity plan ...` | `roomRecognition.ts` label loop (spatial index / per-candidate bbox prefilter) |
| 10 | cp1252 bytes are decoded as UTF-8 (the UI reads files with `File.text()`) | `Büro` arrives as `B�ro`, `Café` as `Caf�` | `cp1252 bytes ...` | `Toolbar.tsx` / a byte-level DXF entry point honouring `$DWGCODEPAGE` |
| 11 | `\U+XXXX` escapes (R2000 and earlier) are not decoded | Arabic text stays as the literal `\U+0627\U+0631...` | `\U+XXXX escapes are not decoded ...` | `dxfParser.ts` text decoding |
| 12 | Consequence of 11: the Arabic ceiling-height annotation `ارتفاع السقف 2.80` gives no suggestion | `suggestion === undefined`, expected 9.186 ft | `the Arabic ceiling-height annotation ...` | follows from 11 |

Not defects (documented behaviour, asserted as such): DIMENSION (4), HATCH (2) and POINT (3) are reported once each as
`UNSUPPORTED_ENTITY`; XDATA, the second layout and its viewport are ignored without diagnostics.

## Measured performance (local, indicative)

| File | Entities | Parse | Store import (`setDxfData`) | Rooms (path A) |
|---|---|---|---|---|
| arch-metric-mm-r2018 | 90 | 8-13 ms | ~1 ms | ~0.5 ms |
| arch-imperial-in-r2010 | 34 | 2-3 ms | 0.3-1.2 ms | - |
| large-office-20k | 19,872 | ~260 ms | ~50-60 ms | ~8 ms (aborts, 0 rooms; gap 9) |

The test bounds are about 3x these numbers with a floor on the tiny ones.
