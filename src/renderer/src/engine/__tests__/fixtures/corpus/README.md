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
`$INSUNITS` / `$MEASUREMENT` / `$LUNITS`. Two checks read the DWG natively (`dwgread -O json`): every INSERT with `has_attribs` must have non-null `first_attrib` / `last_attrib`
resolving to ATTRIBs owned by that INSERT and a `seqend` resolving to a SEQEND, and every model-space INSERT's `block_header` must resolve to the block the source names. A (file, version) pair that differs is not written and is listed under `rejected` in `dwg-manifest.json`.

What LibreDWG 0.13.3 got wrong (found by this check or by reading the DWG), and what was done:

| Writer defect | Handling |
|---|---|
| Entity handles of block definitions / paper space interleaved with model-space handles: the model-space entity list (first..last handle, `nolinks`) swallowed 3 LINE + 1 LWPOLYLINE of a block and 5 ATTRIB | input handles renumbered before `dxf2dwg` (model space last, contiguous), see `normalise_handles` |
| (our generator, not LibreDWG) `normalise_handles` renumbered an INSERT but left its ATTRIB / SEQEND `owner` (group 330) on the old handle, so `dxf2dwg` wrote `has_attribs: 1` with null `first_attrib` / `last_attrib` / `seqend` and every reader saw an INSERT without attributes | children get fresh handles above the model-space range and their owner is re-pointed at the parent's new handle; the native linkage check above fails on such a file |
| Mirrored INSERT (only group 41 = -1) written with yscale = insertion Y, zscale = 0 | all of 41/42/43/50 forced into the input DXF |
| Layer frozen / off / locked flags never written (`flag0` = 0) | patch `libredwg-0.13.3-layer-flags.patch` |
| MTEXT group 40 stored as `rect_width`, text height 0 (every MTEXT then fails our "text height must be positive" check) | patch `libredwg-0.13.3-mtext-height.patch` |
| TEXT `dataflags` inverted: elevation, rotation, oblique angle, width factor, alignments dropped from the file | patch `libredwg-0.13.3-text-dataflags.patch` |
| SPLINE with fit points written as an empty entity | recorded as exclusion `SPLINE.points`; SPLINE sampling is covered by hand-made libredwg-shaped objects in `dwgNativeIntegrity.test.ts` |
| A second `*Model_Space` block record is written | importer ignores layout records for ambiguity (see defects below) |
| R2004 output cannot be read back by LibreDWG itself ("Invalid System Section Page Map") | R2004 rejected |
| R14 cannot hold `$INSUNITS` (and its offs layer flag differs) | R14 kept only for the unitless drawing |
| R14: every INSERT's `block_header` resolves to a BLOCK_HEADER with an empty name (LibreDWG R14 defect: native `dwgread` 0.13.3 shows it too, so it is not the WASM reader) | `unitless-insunits0-r14.dwg` kept with the writer-check exclusion `INSERT.blockName`; documented gap below |

### Importer defects the DWG corpus found (all fixed, tests are plain `it()`)

- `hiddenLayers` was never returned for DWG: `LAYER` entries now give frozen / off layers, and children of a frozen INSERT move onto its layer as in the DXF path.
  The layer flag semantics are **not independently verified** (see "Circularity of the layer-flag evidence" below).
- Paper-space entities were imported into the plan (title block text and lines, viewport): now skipped with one `paper-space-skipped` warning.
- A duplicate `*Model_Space` record produced an `ambiguous-block` **error** diagnostic: layout records are no INSERT targets and are ignored.
- INSERT `attribs` are drawn as TEXT like the DXF path (they were empty only because of our own generator, see the writer table). libredwg-web also appends every top-level INSERT's attributes to `db.entities`
  as loose `ATTRIB` records (owner = the INSERT); those are skipped silently, so an attribute is drawn once and raises no `unsupported-entity` warning.
- SPLINE is sampled (`sampleSplineData`, shared with the DXF parser) instead of dropped. Its closure is derived from the geometry (coincident first / last point, periodic control polygon): libredwg-web's `flag` is
  the DWG `splineflags` (8 = control points, 9 = fit points in R2000-R2013) whose bit 0 is the fit-point method, not "closed" (open fit-point splines 16E / 894 of `example_2000` / `example_2018` used to import closed).
- TEXT / ATTRIB elevation is lost by libredwg-web `convert()`; `parseDwgWith` reads it from the DWG object (`dwg_getall_entity_by_type` + `dwg_dynapi_entity_data(..., 'elevation')`) by handle.
- A `-Z` extrusion (the mirrored door's attribute written by ezdxf) is accepted like in the DXF path: OCS entities are mirrored in X and the sign of Z flips; LINE / ELLIPSE / SPLINE ignore it. Any other normal is still skipped as `nonplanar-entity`.

### Documented gaps (`gap(...)` = `it.fails` unless `CORPUS_SHOW_GAPS=1`)

| Gap | Test | Cause |
|---|---|---|
| R14 INSERTs have an empty block name (8 `missing-block` warnings) | `resolves INSERT block names in R14 files` | LibreDWG R14 defect: the `block_header` of every INSERT resolves to an empty-named BLOCK_HEADER, also in native `dwgread` 0.13.3 (not the WASM reader); recorded as writer-check exclusion `INSERT.blockName` |

### Circularity of the layer-flag evidence

The layer frozen / off / locked flags in the corpus are not independent evidence. `libredwg-0.13.3-layer-flags.patch` edits the **encoder** block of the same `dwg.spec` that defines the **decoder**, the writer check
reads the result with the same LibreDWG (`dwgread`), and libredwg-web is also a LibreDWG build: writer, checker and app reader share one interpretation of `flag0`. What corroborates it from outside:
`example_2004.dwg` stores `ADSK_SYSTEM_LIGHTS` with `flag0` 1017 (bit 1 set), consistent with "frozen = flag0 bit 1". What has **no independent evidence**: "off = flag0 bit 2", because no external file has a switched-off
layer. libredwg-web also maps negative layer colours to 256, so a real file that marks a layer "off" only by a negative colour is not detected as hidden.

### External DWG files (opt-in)

`npm run corpus:fetch-dwg` downloads LibreDWG's `example_2000/2004/2007/2010/2013/2018.dwg` and `sample_2000.dwg` from `raw.githubusercontent.com` at the pinned commit into the
gitignored `.cache/dwg-external/` (sha256 verified, never vendored: GPL test data). `dwgExternal.test.ts` skips without them; `REQUIRE_EXTERNAL_DWG=1` turns a missing or mismatching file into a failure.
`example_2004`..`example_2018` carry an AppInfo block that names AutoCAD build O.48.M.294 (that is the file's own claim, not an independent verification); the two R2000 files (`example_2000`, `sample_2000`) carry
no AppInfo, so their authoring application is not verified either. Hidden layers: the R2000 / R2004 saves have `*ADSK_SYSTEM_LIGHTS` frozen, from R2007 on it is stored unfrozen (native `flag0` 1008), so those saves hide no layer.

## Text justification and far-from-origin drawings (invariants and deferred gaps)

### Text justification (`cad/textJustification.ts`, `cadTextJustification.test.ts`)

- **T1 anchor.** `DxfEntity.x,y` of a TEXT / MTEXT is the point the text is justified about. TEXT / ATTRIB / ATTDEF: group 11 when group 72 is 1, 2 or 4 or the vertical
  justification is non-zero (**73 on TEXT, 74 on ATTRIB / ATTDEF**; 73 on an attribute is the field length and is ignored); the **midpoint** of 10 and 11 for 72 = 3 (aligned) and 5 (fit);
  otherwise group 10. A justified TEXT with a missing or non-finite 11/21 falls back to group 10 with left/baseline and a `TEXT_ALIGNMENT_POINT_MISSING` warning (10 is never paired with a non-left
  alignment); an out-of-range 72/73/74 gives `TEXT_JUSTIFICATION_UNSUPPORTED`. MTEXT: the anchor is always group 10; group 71 (1..9) gives the attachment, absent means top-left (its 11/21 is a direction vector
  and 72/73 are flow / spacing, not justification).
- **T2 storage.** Optional `textHAlign` (`left|center|right`) and `textVAlign` (`baseline|bottom|middle|top`), stored only when different from the type default (TEXT left/baseline, MTEXT left/top). Entities saved
  without them stay valid; unknown values are rejected by `validateCadEntity` (so by project load).
- **T3 transform.** The anchor is resolved *before* `transformCadEntity`, so it receives exactly the matrix group 10 received (DXF parser and the DWG emit step). A mirrored INSERT (det < 0) does **not** swap left/right:
  this is the existing glyph-orientation approximation (see `nativeGeometry.transformCadEntity`).
- **DWG.** TEXT uses `halign` / `valign` with `endPoint` as the alignment point. The DWG stores that point only when the TEXT / ATTRIB `dataflags` bit 0x02 is clear; when it is set the alignment point
  is omitted and equals the insertion point (ODA spec; LibreDWG `dwg.spec`: `if (!(dataflags & 0x02)) FIELD_2DD (alignment_pt, ins_pt)`), and libredwg-web then reports `endPoint` `{0,0}`.
  `dwgParser.attachTextElevations` reads `dataflags` through the typed entity and attaches it by handle (`textDataFlags`, also on INSERT attributes). Bit 0x02 set: the anchor is the insertion point with the declared
  justification and no warning (the committed `entity-units-r2000.dwg` `TXT CENTER` has `halign` 1, `endPoint` `{0,0}`, bit 0x02 set, and matches its DXF twin). Bit clear: `endPoint` is used even when it is `{0,0}`
  (block-local coordinates before the INSERT transform). Only a record without a matched entity (no handle / `dataflags`) falls back to the old heuristic: a justified TEXT whose `endPoint` is exactly `{0,0}`
  counts as missing (`text-alignment-point-missing`, group-10 anchor, left/baseline).
- Export writes TEXT 10 = anchor, 72, 73 and 11/21 = anchor when not left/baseline (72 = 4 *Middle* and 72 = 1 with 73 = 2 both decode to centre/middle; export writes the latter), MTEXT 71 when not top-left.

Deferred text gaps: old saved projects with justified TEXT keep the group-10 anchor, and their MTEXT now draws top-left (it used to be drawn on the alphabetic baseline), until the drawing is re-imported; aligned / fit width fitting and the 10 -> 11 direction (the stored group 50 is used), text extents in the
bbox, MTEXT wrapping / column width, mirrored (generation-flag / det < 0) glyphs, the difference between 72 = 4 and 73 = 2 vertical centring, and DXF font metrics vs canvas `sans-serif` metrics.

### Far-from-origin drawings (`cad/drawingOrigin.ts`, `cadDrawingOrigin.test.ts`)

- **I1** every engine coordinate (entities, bbox, block references, openings, obstacles, zones and components, manifests, temp points, snapshots) is *local*: `raw = local + drawingOrigin`. The origin is in the internal
  Y-down frame: DXF X = `x + ox`, DXF Y = `-(y + oy)`. Z (`elevation`, group 30/31/38) is not localised.
- **I2** `drawingOrigin` changes only in `setDxfData` (it translates every retained zone coordinate by old - new in the same `set()`, re-derives zone obstacles, and clears `deploymentEvidence`, `deploymentInputs` and
  `tempPoints`; the undo stacks are already cleared by an import) and in `restoreProjectDocument` (wholesale). `clearDxfData` never changes it.
- **I3** per axis: 0 when the raw bbox lies within `T = 1e5` drawing units of 0 (absolute threshold), else `round(centre / step) * step` with `step = 10^floor(log10(max(span, 1)))` so components are exact integers; a new
  import reuses the current origin while its raw bbox localised with it stays within T. Every corpus bbox (max |coord| 50,550) keeps origin `{0,0}`.
- **I4** parsers return RAW coordinates and are unchanged (corpus tests compare against ezdxf ground truth in raw coordinates). `setDxfData` takes RAW parser output and is the one place coordinates become local;
  DXF and DWG imports both go through it (`Toolbar.tsx`).
- **I5** export adds the origin to point group codes (10/20, LINE / TEXT / opening 11/21) and never to vectors (ELLIPSE 11/21, 210-230) or Z codes; with origin `{0,0}` the output is byte-identical.
- **I6** no UI shows absolute coordinates.
- **I7** the document carries a top-level `drawingOrigin` only when non-zero, with `version` 3; files with origin `{0,0}` stay version 2. Readers accept v1/v2/v3, treat v1/v2 as `{0,0}`, reject `drawingOrigin` in a
  v < 3 document and require finite values.

Deferred far-origin gaps: v1/v2 projects saved with far-from-origin raw coordinates are **not** localised at load (entity / candidate IDs embed coordinates, so migrating would orphan saved decisions); re-importing the
drawing rebases it. Z is not localised. The engine's absolute tolerances are unchanged (fine in the local frame, but one drawing spanning more than about 1e7 drawing units cannot be centred within T and could still lose precision).

## Adversarial corpus (`adversarial/`, Phase C)

Hostile-input files for the importer, written by `scripts/cad-corpus/generate_adversarial.py` (ezdxf 1.4.4, byte-stable; `npm run corpus:generate-adversarial`).
Ground truth is `adversarial-manifest.json`, computed from the construction geometry or from ezdxf itself (never from our parsers or adjusted to match them). Tests: `cadAdversarialCorpus.test.ts`.

| Item | Files | Result |
|---|---|---|
| C7 line endings and binary | `line-endings-*.dxf`: one ezdxf base file as LF, CRLF, bare CR, trailing spaces/tabs on codes and numeric values, BOM+CRLF; `line-endings-binary.dxf` = `saveas(fmt='bin')` | Defect fixed: bare-CR files parsed as one line (`/\r?\n/` split) and returned nothing; now `/\r\n\|\r\|\n/` in `parseDxfText` and `decodeDxfBytes`. Binary DXF (sentinel `AutoCAD Binary DXF`) used to be parsed as garbage with no message; `decodeDxfBytes` now throws "Binary DXF is not supported" (no reader). |
| C5 noise-2 (`noise-2.dxf`) | R2018 mm: WIPEOUT, ACAD_TABLE (room schedule with larger text than the real label, block `*T1`), OLE2FRAME, IMAGE+IMAGEDEF, ACAD_PROXY_ENTITY (310 hex), XREF block (flags 20, path) + INSERT, ACAD_LAYERSTATES XRECORD, rotated `$UCS*`, `$ANGDIR` 1 / `$ANGBASE` 90 deg, non-zero `$INSBASE`, twisted VIEWPORT in Layout1, entity layers `walls` / `a-frz` vs table `WALLS` / frozen `A-FRZ` | Defects fixed: an XREF INSERT expanded the empty xref block with no message (now `XREF_NOT_LOADED` warning with the path in the DXF parser; `xref-not-loaded` in the DWG parser); layer lookups were case-sensitive (`walls` lost the `WALLS` BYLAYER colour, `a-frz` was not hidden by frozen `A-FRZ`; names are now resolved to the table's spelling). Verified by test, no defect: ARC angles ignore `$ANGDIR` / `$ANGBASE` (they are stored CCW from +X; compared with ezdxf `Arc.start_point/end_point`), UCS / `$INSBASE` move nothing, layer states do not change visibility, the table's text never reaches a label (ACAD_TABLE is unsupported, its `*T1` block is never referenced). |

DWG XREF caveat: `dxf2dwg` 0.13.3 does not write the xref flag/path of a block record, so no real DWG with an xref can be produced here. The DWG-side check (`blkisxref` / `xref_pname` read in `dwgParser.attachXrefs`, handled in `dwgGeometry`) is tested only with a hand-made libredwg-shaped database and the dynapi field names were confirmed to exist (they return 0 / '' on a DWG without xrefs); it has never run against a real xref DWG.
