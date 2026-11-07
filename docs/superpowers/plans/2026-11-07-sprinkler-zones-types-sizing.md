# Sprinkler Shop Drawings — Designer Zones, Sprinkler Types & Pipe Sizing (NFPA 13-2019) — Plan

User: "Make a full drawing DXF/DWG for the sprinkler system for each floor; I select the zone, give the hazard and the
type of sprinkler, then you make the pipe sizing and distribution according to NFPA 13 — full shop drawing."

Contract additions (`sprinkler/sprinklerTypes.ts`): `SprinklerAnswers.pipeSizing | minSupplyMarginPsi`,
`SprinklerOrientation 'sidewall'`, `SprinklerHeadSpec`, `SprinklerZoneInput`, `SprinklerRoomInput.headSpec | zoneId |
source`, `SprinklerFloorInput.zones`, `PlacedSprinkler.zoneId`, `SprinklerPipe.zoneId`, `RemoteAreaResult.zoneId`,
`SprinklerFloorDesign.zones`, `SprinklerZoneResult`.
Tests (must pass unchanged): `__tests__/sprinklerZonesAndTypes.test.ts` (K6 engine), `__tests__/sprinklerShopDrawingZones.test.ts`
(K7 drawings/report); all existing sprinkler tests keep passing unchanged (defaults reproduce today's behaviour).

## K6 Engine
1. **Head spec** (`selectHeadType`): when `room.headSpec` is set, use its K, orientation, response, temperature;
   id `${QR|SR}-${PEN|UPR|DPEN|CPEN|HSW}-K${k}-${temp}` (deluge keeps OPEN); tempClass: ≤170 °F ordinary, 175–225
   intermediate, ≥250 high; bulb colours 135 orange, 155 red, 175 yellow, 200 green, 286 blue. Room check
   `spr-head-spec:<roomId>` (pass/warn/fail with reasons): wet pendent/concealed/upright/sidewall on dry or preaction
   systems → fail (only dry-pendent / dry-sidewall / upright, NFPA 13 §8.2); upright under 'finished-flat' → warn;
   pendent under 'exposed-structure' → warn (drops required); extra hazard with K < 11.2 → warn; freezing room with a
   non-dry head on a wet system → fail; light hazard standard response is reported by the existing floor check
   `spr-quick-response` (must use the actual head types). Otherwise pass.
2. **Standard horizontal sidewall** (NFPA 13 §10.3, Table 10.3.4.2.1 / 10.3.3.2.1): light: max S 14 ft, throw 14 ft,
   area 196 ft²; ordinary: 10 ft, 10 ft, 100 ft²; extra: not permitted. Layout on the polygon bbox: wall = the bbox
   side parallel to the longer dimension nearest the zone riser (tie → lower y / smaller x); width W = bbox size
   perpendicular to it. W ≤ throw → one wall, L(throw) = W; W ≤ 2·throw → both opposite walls, L = W/2; else both
   walls + `spr-sidewall:<roomId>` fail. Heads 150 mm from the wall; along the wall n = ceil(len / Smax) with
   Smax = min(maxS, maxArea/L), S = len/n, positions at (i + ½)·S; keep heads inside the polygon. Room result:
   spacingSmm = S, spacingLmm = L, maxSpacingMm = maxS ft × 304.8, maxAreaFt2 = maxArea. `spr-sidewall` pass (light),
   warn (ordinary: "only where listed for ordinary hazard"), fail (extra or too wide). Area per head = S × L. The
   standard spray checks (coverage / wall distance) do not apply to sidewall areas (replace by spr-sidewall).
3. **Zones**: floor.zones (default one zone 'Z1' named floor.name at floor.riser). room.zoneId ?? first zone. Heads
   are numbered floor-wide as today. Piping, hydraulics and remote areas are run per zone with the zone riser:
   zone 1 node names unchanged (FC, R, J…); other zones prefix: FC-<z>, R-<z>, junctions <z>-J… . Each zone's R joins
   the building riser rows (BR, SRC) exactly as today. Zone result: controlValveTag `ZCV-<floor>-<zone>`, node, roomIds,
   headCount, area (sum of its rooms), maxAreaFt2 = 52,000 (40,000 if any extra hazard room) and check
   `spr-zone-area:<floor>/<zone>`; governing = worst of its remote areas; floor governing = worst zone (max pressure at
   source). Floor-level checks aggregate the zones. Accessories: one zone (floor) control valve assembly per zone.
4. **Hydraulic pipe sizing** (`answers.pipeSizing === 'hydraulic'`): start every branch segment at 1" and every
   cross-main / feed / riser nipple at 1¼"… no — start: branch 1", cross-main & feed 1½", riser nipple 2"; iterate
   (≤ 500): compute all remote areas; (a) any segment row with velocity > 20 ft/s (good practice, not an NFPA limit)
   → upsize it one size; else (b) any remote area with margin < minSupplyMarginPsi (default 10) → upsize the segment
   with the largest friction loss on that area's path; enforce non-increasing sizes toward the sprinklers (a pipe is
   never smaller than any pipe it feeds); stop when (a) and (b) hold. Check `spr-pipe-sizing:<floor>` (pass, detail
   names the method "hydraulic (NFPA 13 Ch. 28)" or "pipe schedule (§28.5) hydraulically verified").
   Default 'schedule-verified' = today.

## K7 Drawings (FS-1xx per floor), report, UI
- Zone boundaries (layer FS-ZONE, distinct linetype/colour per zone, label "ZONE Zk - name - hazard … m² / ft²"),
  zone control valve assembly symbol + tag at each zone riser, zone schedule table (zone, name, areas, hazards,
  heads, ZCV tag, area vs 52,000 ft² limit, governing flow/pressure).
- Dimensions (layer FS-DIMS) for every area: head-to-wall (both axes) and head spacing strings along the first row and
  column; sidewall: distance from the wall and spacing.
- Sprinkler symbols per type (pendent, upright, concealed, dry pendent, sidewall with throw arrow); head schedule by
  type (id, description, K, response, temperature/bulb colour, quantity per zone).
- Reducer marks where the pipe size changes, pipe size/length on every segment, hanger tags, note of the sizing
  method ("HYDRAULICALLY CALCULATED" / "PIPE SCHEDULE … VERIFIED").
- Report: zones, sprinkler types (designer-selected vs automatic), sizing method, per-zone remote area summary.
- UI (SprinklerPanel): draw areas on the plan (click vertices, snap 100 mm / plan vertices, close on first point),
  edit/delete detected or drawn areas; per area: hazard, occupancy, sprinkler type (Automatic or K / orientation incl.
  sidewall & concealed / response / temperature), ceiling, zone; zones list (add/rename, click to place the zone
  control valve); pipe sizing method; per-floor DXF / DWG downloads (existing).
