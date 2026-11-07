#!/usr/bin/env python3
"""Validate an IFC file produced by the MEP app (schema + geometry), the way Revit's IFC link will read it.

usage: python3 scripts/validate_ifc.py model.ifc [--json]
Requires: pip install ifcopenshell
Checks: IFC4 schema validation (ifcopenshell.validate), every IfcProduct of an MEP class is contained in a storey,
assigned to a system, has a placement and a body representation that ifcopenshell.geom can triangulate,
GlobalIds unique, units are millimetres. Prints a summary and exits 1 on any error.
"""
import sys, json, logging, collections
import ifcopenshell, ifcopenshell.validate, ifcopenshell.geom, ifcopenshell.util.element as ue

def main(path, as_json=False):
    f = ifcopenshell.open(path)
    errors = []
    class L(logging.Handler):
        def emit(self, rec): errors.append(f"schema: {self.format(rec)}"[:300])
    log = logging.getLogger("v"); log.handlers = [L()]; log.setLevel(logging.ERROR); log.propagate = False
    ifcopenshell.validate.validate(f, log, express_rules=False)
    if f.schema != "IFC4": errors.append(f"schema is {f.schema}, expected IFC4")
    lu = [u for u in f.by_type("IfcSIUnit") if u.UnitType == "LENGTHUNIT"]
    if not lu or lu[0].Prefix != "MILLI": errors.append("length unit is not millimetre")
    gids = [e.GlobalId for e in f.by_type("IfcRoot")]
    if len(gids) != len(set(gids)): errors.append("duplicate GlobalIds")
    settings = ifcopenshell.geom.settings()
    counts = collections.Counter(); storeys = collections.Counter(); bad_geom = 0
    for p in f.by_type("IfcDistributionElement") + f.by_type("IfcBuildingElementProxy"):
        counts[p.is_a()] += 1
        st = ue.get_container(p)
        if not st or not st.is_a("IfcBuildingStorey"): errors.append(f"{p.is_a()} {p.Name} not contained in a storey")
        else: storeys[st.Name] += 1
        if not any(r.is_a("IfcRelAssignsToGroup") and r.RelatingGroup.is_a("IfcSystem") for r in p.HasAssignments):
            errors.append(f"{p.is_a()} {p.Name} not assigned to a system")
        if p.ObjectPlacement is None or p.Representation is None:
            errors.append(f"{p.is_a()} {p.Name} without placement/representation"); continue
        try:
            sh = ifcopenshell.geom.create_shape(settings, p)
            if len(sh.geometry.verts) == 0: bad_geom += 1
        except Exception as ex:
            bad_geom += 1
            if bad_geom < 5: errors.append(f"geometry {p.is_a()} {p.Name}: {ex}")
    if bad_geom: errors.append(f"{bad_geom} element(s) without valid geometry")
    out = {"file": path, "schema": f.schema, "elements": dict(counts), "storeys": dict(storeys),
           "systems": [s.Name for s in f.by_type("IfcDistributionSystem")], "errors": errors[:50], "ok": not errors}
    if as_json: print(json.dumps(out, indent=1))
    else:
        print(f"{path}: {sum(counts.values())} MEP elements in {len(storeys)} storeys, {len(out['systems'])} systems")
        for k, v in sorted(counts.items()): print(f"  {k}: {v}")
        for e in errors[:50]: print("  ERROR", e)
        print("IFC OK" if not errors else f"IFC FAILED ({len(errors)} errors)")
    return 0 if not errors else 1

if __name__ == "__main__":
    sys.exit(main(sys.argv[1], "--json" in sys.argv))
