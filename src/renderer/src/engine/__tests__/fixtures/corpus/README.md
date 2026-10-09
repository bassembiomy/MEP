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
- Frozen (`70` bit 1) and off (negative colour) layers are imported but hidden by default (`DxfLayerInfo.sourceHidden`), kept out of snapping, room / opening / obstacle recognition and ceiling-height suggestions until the user shows them. Room approval is bound to that state (showing or hiding such a layer makes earlier room candidates stale), and DXF export writes a layer that is still hidden as frozen (`70` = 1; the importer does not record frozen-vs-off, so an off layer is exported frozen) while a layer the user showed is exported thawed. Freezing an INSERT's layer hides the whole reference: block children on other layers are moved onto that layer (`DxfEntity.originalLayer` keeps their own); turning it OFF only hides layer-0 children, which inherit it. The manifest note ("hidden-layer entities included") still holds because they remain in `dxfEntities`.

Not defects (documented behaviour, asserted as such): DIMENSION (4), HATCH (2) and POINT (3) are reported once each as
`UNSUPPORTED_ENTITY`; XDATA, the second layout and its viewport are ignored without diagnostics.

## Measured performance (local, indicative)

| File | Entities | Parse | Store import (`setDxfData`) | Rooms (path A) |
|---|---|---|---|---|
| arch-metric-mm-r2018 | 90 | 8-13 ms | ~1 ms | ~0.5 ms |
| arch-imperial-in-r2010 | 34 | 2-3 ms | 0.3-1.2 ms | - |
| large-office-20k | 19,872 | ~250 ms | ~50-75 ms | ~8 ms (48 rooms) |

The test bounds are about 3x these numbers with a floor on the tiny ones.

## Binary DWG corpus (`dwg/`)

Real binary DWG files for the libredwg-web import path (`dwgBinaryCorpus.test.ts`). `@mlightcad/libredwg-web` 0.7.7 has no DWG writer, so
the files are written by the native **LibreDWG 0.13.3 `dxf2dwg`** (built outside the repo by `scripts/cad-corpus/build_libredwg.sh`, pinned to the
release commit plus three small patches in `scripts/cad-corpus/patches/`) from **R2000 DXF twins** of the DXF corpus above:

```
scripts/cad-corpus/build_libredwg.sh                 # clone + build LibreDWG into ~/.cache/mep-libredwg (not part of npm test)
npm run corpus:generate-dwg                          # twins (generate_corpus.py --r2000-twins) -> dxf2dwg -> writer check -> dwg/*.dwg
```

`dwg/*-r2000.dxf` are the twins (ezdxf 1.4.4), `dwg/twins-manifest.json` their ground truth (same construction geometry as `manifest.json`), `dwg/dwg-manifest.json`
the sha256 of every committed `.dwg`, the LibreDWG version and patches, ezdxf-derived counts, layers, blocks and texts, and the **writer check** result.
The `.dwg` bytes are not reproducible (LibreDWG stamps them); the sha256 identifies the committed files. Tests read the files only and never need Python or the build.

| File | Version | Source |
|---|---|---|
| `arch-metric-mm-r2000.dwg`, `arch-imperial-in-r2000.dwg` | R2000 | doors with ATTDEF/ATTRIB at 4 rotations + one mirrored, windows, columns, MTEXT room names, A-AREA rooms |
| `unitless-insunits0-r2000.dwg`, `unitless-insunits0-r14.dwg` | R2000, R14 | `$INSUNITS` 0 (R14 has no unit variable, so only the unitless drawing passes its writer check) |
| `elevated-levels-r2000.dwg` | R2000 | z=0 and z=3500 levels, one non-planar 3D line |
| `noise-dim-hatch-spline-paper-r2000.dwg` | R2000 | DIMENSION (3), HATCH, POINT, SPLINE, ELLIPSE, frozen `A-FRZ` and off `A-OFF` layers, Layout1 title block, Layout2 viewport (the rotated vertical dimension is left out of the twin: LibreDWG's DXF reader rejects the MTEXT group 50 ezdxf writes inside it) |
| `entity-units-r2000.dwg` | R2000 | one of every entity with construction values in degrees: ARC 30-120 and 270-90, partial ELLIPSE, bulged LWPOLYLINE, TEXT rotation 90 / centre / oblique+width, MTEXT 45 degrees, scaled+rotated INSERT, nested INSERT |

### Writer check (independent of our parsers)

Each DWG is read back by LibreDWG's own `dwg2dxf` / `dwgread -O json` and compared with the ezdxf source document: entity counts by type and by layer, rounded geometry of
every entity, text content and height, paper-space entities, INSERT attributes, layer flags (frozen / off / locked / colour), block names, anonymous dimension blocks,
`$INSUNITS` / `$MEASUREMENT` / `$LUNITS`. A (file, version) pair that differs is not written and is listed under `rejected` in `dwg-manifest.json`.

What LibreDWG 0.13.3 got wrong (found by this check or by reading the DWG), and what was done:

| Writer defect | Handling |
|---|---|
| Entity handles of block definitions / paper space interleaved with model-space handles: the model-space entity list (first..last handle, `nolinks`) swallowed 3 LINE + 1 LWPOLYLINE of a block and 5 ATTRIB | input handles renumbered before `dxf2dwg` (model space last, contiguous), see `normalise_handles` |
| Mirrored INSERT (only group 41 = -1) written with yscale = insertion Y, zscale = 0 | all of 41/42/43/50 forced into the input DXF |
| Layer frozen / off / locked flags never written (`flag0` = 0) | patch `libredwg-0.13.3-layer-flags.patch` |
| MTEXT group 40 stored as `rect_width`, text height 0 (every MTEXT then fails our "text height must be positive" check) | patch `libredwg-0.13.3-mtext-height.patch` |
| TEXT `dataflags` inverted: elevation, rotation, oblique angle, width factor, alignments dropped from the file | patch `libredwg-0.13.3-text-dataflags.patch` |
| SPLINE with fit points written as an empty entity | recorded as exclusion `SPLINE.points`; SPLINE sampling is covered by hand-made libredwg-shaped objects in `dwgNativeIntegrity.test.ts` |
| A second `*Model_Space` block record is written | importer ignores layout records for ambiguity (see defects below) |
| R2004 output cannot be read back by LibreDWG itself ("Invalid System Section Page Map") | R2004 rejected |
| R14 cannot hold `$INSUNITS` (and its offs layer flag differs) | R14 kept only for the unitless drawing |

### Importer defects the DWG corpus found (all fixed, tests are plain `it()`)

- `hiddenLayers` was never returned for DWG: `LAYER` entries now give frozen / off layers, and children of a frozen INSERT move onto its layer as in the DXF path.
  Confirmed on real Autodesk-saved files: `example_2000.dwg` / `example_2004.dwg` carry `ADSK_SYSTEM_LIGHTS` with layer flag 1017 (frozen).
- Paper-space entities were imported into the plan (title block text and lines, viewport): now skipped with one `paper-space-skipped` warning.
- A duplicate `*Model_Space` record produced an `ambiguous-block` **error** diagnostic: layout records are no INSERT targets and are ignored.
- INSERT `attribs` (when present) are drawn as TEXT like the DXF path; SPLINE is sampled (`sampleSplineData`, shared with the DXF parser) instead of dropped.

### Documented gaps (`gap(...)` = `it.fails` unless `CORPUS_SHOW_GAPS=1`)

| Gap | Test | Cause |
|---|---|---|
| No TEXT per visible INSERT attribute (door tags D01...) in the DWG import | `draws one TEXT per visible INSERT attribute` (metric, imperial) | libredwg-web 0.7.7 returns `attribs: []` for every INSERT of these R2000 files although the ATTRIB objects exist in the file (`dwg_getall_entity_by_type`) |
| TEXT elevation lost | `elevated-levels: TEXT keeps its elevation` | libredwg-web `convert()` has no elevation field on TEXT |
| R14 INSERTs have an empty block name (8 `missing-block` warnings) | `resolves INSERT block names in R14 files` | libredwg-web reader on a LibreDWG-written R14 file (`Open dwg file with error code: 64`) |

### External DWG files (opt-in)

`npm run corpus:fetch-dwg` downloads LibreDWG's `example_2000/2004/2007/2010/2013/2018.dwg` and `sample_2000.dwg` from `raw.githubusercontent.com` at the pinned commit into the
gitignored `.cache/dwg-external/` (sha256 verified, never vendored: GPL test data). `dwgExternal.test.ts` skips without them. `example_2004`..`example_2018` carry an AppInfo block that
names AutoCAD build O.48.M.294 (that is the file's own claim); the two R2000 files carry no AppInfo, so their authoring application is not verified.
