# Standpipe Risers — Avoid PRVs by Pressure Zoning (NFPA 14) — Plan

User requirement: *always avoid the PRV solution and design the best riser system without PRVs; always ask about the
service floors; always give both solutions (with PRV and without PRV).*

Contract: `fpTypes.ts` — `StandpipeDesignInput.prvStrategy | serviceFloorIds | zonePumpShutoffRatio`,
`StandpipeZoneStation`, `StandpipeZone`, `StandpipeSolution`, `StandpipeZoningStudy`, `StandpipeOutlet.zoneId`,
`StandpipeSystemDesign.zoning`. Acceptance test: `src/renderer/src/engine/__tests__/fireStandpipeZoning.test.ts`
(must pass unchanged). Oracle: `docs/superpowers/plans/2026-11-07-standpipe-prv-zoning-oracle.py` (reproduces the
existing single-zone calculation exactly: 168.2403 psi, 207.70 psi static).

## Z1 — Engine (`standpipeZoning.ts` + integration)

Basis: NFPA 14-2019 §7.2.1 (≤ 350 psi anywhere), §7.2.3 (2½" outlet static > 175 psi needs a PRD; 1½" residual > 100),
§7.9 (zones; each zone requiring pumps has its own pump), §7.8 (100 psi residual at the top outlet), NFPA 20 §4.31
(break tanks), NFPA 14 §7.10.1.2 (30 min).

Definitions (all elevations m, pressures psi, ft = m × 3.28084):
- Outlet list U = outlets of the riser with the roof outlet (all risers share the same zone elevation bands), bottom→top.
- Zone = contiguous band U[i..t]; for every riser, its outlets inside the band [U[i].elev, U[t].elev].
- Station candidates for a zone starting at i: i = 0 → 'pump-room' (main pumps, CL = existing pumpCLAbsM); i > 0 →
  'express' (pump in the pump room, same CL); plus every service floor f with f.elevationM ≤ FFL of U[i]'s floor →
  'service-floor', CL = f.elevationM + pumpCenterlineHeightM(ratedGpm). A service floor may host several zone pump sets.
- Suction: pump room / express: suctionMin = pumps.suctionPressureMinPsi, suctionMax = pumps.maxStaticSuctionPsi (from a
  first pump selection with the unchanged demand). Service floor (break tank, water 2.0 m above pump CL max, empty at
  end): suctionMin = 0, suctionMax = 0.433 × 2.0 × 3.28084.
- Zone requirement per riser = the existing riser calculation restricted to the band: H1 (2½" 1 ft, tee-branch +
  angle hose valve, top residual), riser segments, flows as today (k = 1 → 500 gpm; Class I/III top two 250/250;
  Class II 100), "Riser base" from the lowest zone outlet to the FFL of that outlet's floor (elbow), then the supply
  segment to the station: horizontal = loc.horizontalRunToPumpM (pump-room / express) or 10 m (service floor), rise =
  (zone base FFL − station CL), main size, fittings 2 elbows + tee + gate, flow Q (full standpipe demand per zone).
  requiredPressurePsi = max over risers; governingRiserTag = argmax. Node names: zone 1 exactly as today
  (`T-H1 … T-SB`, `PD`); zone k ≥ 2: `T-Zk-H1 … T-Zk-SB`, `PD-Zk`.
- ratedFlow = selectRatedCapacity(Q); rated = ceil5(req − suctionMin) (as pumpSelector); shutoff ratio r = 1.2 for
  'pump-room', `zonePumpShutoffRatio ?? 1.2` otherwise; pump curve P(x) = rated·(r + 0.066667x − (r − 1 + 0.066667)x²)
  (= the engine curve for r = 1.2). churnDischarge = r·rated + suctionMax.
  maxStatic = churnDischarge − 0.433·(U[i].elev − CL)·ft. topResidual = 100 + (P(Q/ratedFlow) + suctionMin − req)
  (Class II: 65). feasible = maxStatic ≤ 175 and churnDischarge ≤ 350.
  prvOutlets (infeasible) = outlets of all risers in the band with churnDischarge − 0.433·(elev − CL)·ft > 175.
- **Without-PRV partition = dynamic programming** over start index i: options = every station candidate × every t ≥ i
  with feasible zone (an infeasible zone is allowed only as the last zone, t = n − 1, cost += prvOutlets, +1000 if
  churn > 350). Minimise lexicographically (total PRV outlets, zones, express zones, Σ rated psi); tie → larger t first.
  Zones numbered Z1… bottom→top.
- expressRiserLengthM = zone base FFL − pumpRoomFloorElevationM (express only). breakTank (service floor):
  volumeGal = Q × 30, nfpa20BreakTankGal = 1.5 × ratedFlow × 15, m³ = gal × 0.003785411784.
- **With-PRV solution** = one 'pump-room' zone over all outlets (same formulas); prvCount = outlets with static > 175
  (1½": per existing rule); feasible = churnDischarge ≤ 350.
- Solution fields: pumpSets = zones.length; expressRisers; serviceFloorStations = distinct station floor ids (bottom→top);
  maxStaticPsi = max zone maxStatic; summary = comparison bullet points (equipment, PRV maintenance NFPA 25 — 5-yr
  full-flow test, failure risk, drain riser, break tanks/booster sets, express riser pressure, cost/space);
  suggestion (without-PRV not feasible) = "Provide a service floor at or below <floorId of the first infeasible zone's
  lowest outlet> …" (must contain that id), else null.
- Study: strategy = prvStrategy ?? 'avoid'; serviceFloorsAnswered = Array.isArray(serviceFloorIds); serviceFloorIds =
  answered list or []; selected = strategy === 'allow' ? 'with-prv' : 'without-prv'.

Engine integration (`fireProtectionEngine.ts`): compute spHyd as today → demand → pumps0 → zoning → if selected
'without-prv': spHyd.pressureAtPumpDischargePsi = Z1.requiredPressurePsi, spHyd.rows = Z1.rows, recompute demand
with that standpipe pressure and select the final pumps; else keep. `analyzeStandpipeOutlets` uses the selected
solution: zone 1 outlets from the actual main pump (as today), other zones from the zone pump (rated, r, suction of
its station; static = r·rated + suctionMax − 0.433·Δz; residual = P(x) + suctionMin − 0.433·Δz − friction from the zone
rows); every zone's governing riser has its top outlets flowing (zone demand); zoneId on every outlet; PRV rule as today.
Checks (add): `sp-service-floors` (warn + "answer: which floors are service floors…" until answered, else pass listing
them or "no service floors"), `sp-zoning` (selected without-PRV & feasible → pass; without-PRV infeasible → warn with
suggestion; with-PRV selected while without-PRV feasible → warn), `sp-express-riser` (express churn ≤ 350 pass else
fail; none → pass "no express risers"), `sp-break-tank` (per service-floor zone, pass, volumes). `sp-prv` detail must say
"No pressure-regulating devices" when none. `sp-zone-height` per zone.
Report: section "STANDPIPE PRESSURE ZONING — WITH PRV vs WITHOUT PRV" with both solutions, zones, stations, express
risers, break tanks, pumps, comparison, selected solution, service floors (or the open question).

Existing tests that asserted the single-zone PRV design on DEFAULT_FIRE_INPUT keep their expectations by using
`prvStrategy: 'allow'` (do not change their numbers).

## Z2 — Drawings, report, UI
- FP-106 riser diagram: zone bands with labels (Z1…, station, pump rating), express risers (no outlets), service-floor
  stations (break tank + booster pump set symbols, fill line), PRVs only where prvRequired.
- New sheet FP-111 "STANDPIPE ZONING STUDY — WITH PRV vs WITHOUT PRV": two side-by-side schematic elevations + comparison
  table (zones, pump sets, PRVs, express risers, break tanks, max static, top residual, selected).
- UI (Standpipe inputs): strategy selector (Avoid PRVs — recommended / Allow PRVs); **required service-floor question**
  (checkbox per floor + "No service floors"), highlighted until answered; zone pump shutoff ratio; results comparison of
  both solutions.
