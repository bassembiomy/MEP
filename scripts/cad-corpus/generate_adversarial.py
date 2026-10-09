#!/usr/bin/env python3
"""Adversarial CAD corpus (Phase C) for the MEP importer tests.

Regenerate with:  python3 scripts/cad-corpus/generate_adversarial.py      (requires ezdxf==1.4.4)

Files are written by ezdxf (independent writer) and/or byte-transformed from an ezdxf file; adversarial-manifest.json
holds GROUND TRUTH computed from the construction geometry below (or from ezdxf itself, e.g. MLine.virtual_entities()).
It is never computed from, or adjusted to, our own parser. Coordinates are DXF drawing units, Y up (the parser flips Y).
Output is byte-stable (fixed ezdxf metadata, PYTHONHASHSEED pinned).
"""
import json
import math
import os
import sys

if os.environ.get("PYTHONHASHSEED") != "0":
    os.environ["PYTHONHASHSEED"] = "0"
    os.execv(sys.executable, [sys.executable, os.path.abspath(__file__)] + sys.argv[1:])

import ezdxf
from ezdxf import units as ez_units

if ezdxf.__version__ != "1.4.4":
    sys.exit(f"ezdxf 1.4.4 required (found {ezdxf.__version__}): pip install ezdxf==1.4.4")
ezdxf.options.write_fixed_meta_data_for_testing = True

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "src", "renderer", "src", "engine", "__tests__",
                                    "fixtures", "corpus", "adversarial"))
MM_PER_FT = 304.8


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def poly_area(pts):
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def new_doc(version="R2018", insunits=4, measurement=1):
    doc = ezdxf.new(version, setup=True)
    if insunits is not None:
        doc.units = insunits
    doc.header["$MEASUREMENT"] = measurement
    return doc


def add_layers(doc, names):
    for i, n in enumerate(names):
        if n not in doc.layers:
            doc.layers.add(n, color=(i % 7) + 1)


def path(name):
    return os.path.join(OUT, name)


def write_bytes(name, data):
    with open(path(name), "wb") as fh:
        fh.write(data)


def save_doc(doc, name, **kw):
    doc.saveas(path(name), **kw)


# ------------------------------------------------------------------------------------------------- C7
def gen_line_endings(manifest):
    """One base file, byte transforms. Every text variant must parse identically; the binary one must be refused clearly."""
    doc = new_doc()
    add_layers(doc, ["A-WALL", "A-AREA", "A-ANNO-TEXT"])
    msp = doc.modelspace()
    room = rect(0, 0, 5000, 4000)
    msp.add_lwpolyline(room, close=True, dxfattribs={"layer": "A-AREA"})
    for (a, b) in zip(room, room[1:] + room[:1]):
        msp.add_line(a, b, dxfattribs={"layer": "A-WALL"})
    msp.add_circle((2500, 2000), 300, dxfattribs={"layer": "A-WALL"})
    msp.add_arc((1000, 1000), 500, 30, 120, dxfattribs={"layer": "A-WALL"})
    msp.add_text("OFFICE 1", height=250, dxfattribs={"layer": "A-ANNO-TEXT", "insert": (1500, 3000)})
    base = "line-endings-base-lf.dxf"
    save_doc(doc, base)
    raw = open(path(base), "rb").read().replace(b"\r\n", b"\n")
    assert b"\r" not in raw
    write_bytes(base, raw)
    lines = raw.split(b"\n")
    assert lines[-1] == b""
    lines = lines[:-1]  # every element is one line; the last line is terminated
    numeric_codes = set()
    for c in list(range(10, 60)) + list(range(60, 100)) + list(range(210, 240)) + list(range(280, 290)) + [0, 5, 330, 100]:
        numeric_codes.add(c)

    def join(sep, trail_codes=b"", trail_values=b"", bom=False):
        out = bytearray(b"\xef\xbb\xbf" if bom else b"")
        for i in range(0, len(lines), 2):
            code, value = lines[i], lines[i + 1]
            c = int(code.strip())
            out += code + trail_codes + sep + value + (trail_values if c in numeric_codes else b"") + sep
        return bytes(out)

    variants = {
        "line-endings-crlf.dxf": join(b"\r\n"),
        "line-endings-cr-only.dxf": join(b"\r"),
        "line-endings-trailing-ws.dxf": join(b"\n", trail_codes=b" \t ", trail_values=b"\t  "),
        "line-endings-trailing-ws-crlf.dxf": join(b"\r\n", trail_codes=b"  ", trail_values=b" \t"),
        "line-endings-bom-crlf.dxf": join(b"\r\n", bom=True),
    }
    for name, data in variants.items():
        write_bytes(name, data)
    bin_name = "line-endings-binary.dxf"
    save_doc(doc, bin_name, fmt="bin")
    ents = [e for e in msp if e.dxftype() in ("LINE", "LWPOLYLINE", "CIRCLE", "ARC", "TEXT")]
    manifest["line-endings-base-lf.dxf"] = {
        "item": "C7", "insunits": 4, "measurement": 1, "drawingUnit": "mm", "unitsPerFoot": MM_PER_FT,
        "expected": {"cadUnit": "mm", "unitsConfidence": "declared"},
        "expectedEntityCount": len(ents),
        "textVariants": sorted(variants) ,
        "binaryVariant": bin_name,
        "binarySentinel": "AutoCAD Binary DXF",
        "room": {"polygon": [c for p in room for c in p], "areaSqFt": poly_area(room) / MM_PER_FT ** 2},
    }


# ------------------------------------------------------------------------------------------------- C5
SUPPORTED = {"LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC", "ELLIPSE", "TEXT", "MTEXT"}
XREF_PATH = "C:\\Projects\\Campus\\site-plan.dwg"
TABLE_TEXTS = ["ROOM SCHEDULE", "CONFERENCE ROOM", "OPEN OFFICE", "STORAGE", "212 m2"]


def splice_entities(text, records):
    """Insert raw DXF records at the end of the ENTITIES section (what a producer with proxy/OLE/table objects writes)."""
    marker = "  0\nENDSEC\n  0\nSECTION\n  2\nOBJECTS\n"
    assert text.count(marker) == 1 and "\r" not in text
    return text.replace(marker, "".join(records) + marker)


def raw(*pairs):
    return "".join(f"{c:3d}\n{v}\n" for c, v in pairs)


def gen_noise2(manifest):
    doc = new_doc("R2018", 4, 1)
    doc.header["$HANDSEED"] = "FFFF"
    add_layers(doc, ["A-AREA", "A-ANNO-TEXT", "A-FURN", "A-OVERLAY", "A-XREF", "A-FRZ"])
    doc.layers.add("WALLS", color=1)
    doc.layers.get("A-FRZ").freeze()
    # header traps: rotated UCS, angle conventions, insertion base. None of them moves WCS geometry or reinterprets ARC angles.
    doc.header["$UCSNAME"] = "PLAN90"
    doc.header["$UCSORG"] = (1000.0, 500.0, 0.0)
    doc.header["$UCSXDIR"] = (0.0, 1.0, 0.0)
    doc.header["$UCSYDIR"] = (-1.0, 0.0, 0.0)
    doc.header["$ANGDIR"] = 1
    doc.header["$ANGBASE"] = math.pi / 2
    doc.header["$INSBASE"] = (12345.0, 6789.0, 0.0)
    msp = doc.modelspace()
    room = rect(0, 0, 6000, 5000)
    msp.add_lwpolyline(room, close=True, dxfattribs={"layer": "A-AREA"})
    for (a, b) in zip(room, room[1:] + room[:1]):
        msp.add_line(a, b, dxfattribs={"layer": "walls"})  # table layer is 'WALLS' (colour 1): lookups are case-insensitive
    msp.add_line((7000, 0), (9000, 0), dxfattribs={"layer": "a-frz"})  # table layer 'A-FRZ' is frozen
    msp.add_text("OFFICE 1", height=250, dxfattribs={"layer": "A-ANNO-TEXT", "insert": (500, 4300)})
    arcs = [((8000, 1000), 700, 20, 100), ((8000, 3000), 500, 300, 40)]
    for c, r, a0, a1 in arcs:
        msp.add_arc(c, r, a0, a1, dxfattribs={"layer": "A-FURN"})
    # unsupported entity types, one of each
    msp.add_wipeout([(100, 100), (1100, 100), (1100, 600), (100, 600)], dxfattribs={"layer": "A-OVERLAY"})
    idef = doc.add_image_def("scan/site-photo.png", (640, 480))
    msp.add_image(idef, (2000, 100), (1000, 750), dxfattribs={"layer": "A-OVERLAY"})
    # XREF: a block definition with BLOCK flags 4 and the path in group 1, plus an INSERT of it
    doc.add_xref_def(XREF_PATH, "SITE-PLAN")
    msp.add_blockref("SITE-PLAN", (0, 0), dxfattribs={"layer": "A-XREF"})
    # ACAD_TABLE: the graphic lives in anonymous block *T1 (MTEXT + grid LINEs), which is NOT referenced by any INSERT
    tb = doc.blocks.new("*T1")
    cx, cy = 3000, 2500
    for i, t in enumerate(TABLE_TEXTS):
        tb.add_mtext(t, dxfattribs={"insert": (cx, cy - i * 500), "char_height": 400, "layer": "A-ANNO-TEXT"})
    for i in range(len(TABLE_TEXTS) + 1):
        tb.add_line((cx - 100, cy + 250 - i * 500), (cx + 2900, cy + 250 - i * 500), dxfattribs={"layer": "A-ANNO-TEXT"})
    # layer states: an XRECORD per state in ACAD_LAYERSTATES (a state that would switch A-FURN off must NOT hide it)
    ls = doc.rootdict.add_new_dict("ACAD_LAYERSTATES")
    xr = doc.objects.add_xrecord(owner=ls.dxf.handle)
    xr.reset([(1, "NIGHT"), (90, 1), (8, "A-FURN"), (70, 1), (62, -7), (8, "A-FRZ"), (70, 0), (62, 7)])
    ls["NIGHT"] = xr
    # the active paper space (Layout1) is written into ENTITIES with group 67 = 1; give it a twisted VIEWPORT
    lay = doc.layout("Layout1")
    vp = lay.add_viewport(center=(150, 100), size=(200, 120), view_center_point=(3000, 2500), view_height=7000)
    vp.dxf.view_twist_angle = 33.0
    tmp = path("noise-2.dxf")
    doc.saveas(tmp)
    text = open(tmp, encoding="utf-8").read()
    text = splice_entities(text, [
        # ACAD_TABLE referencing *T1 (AutoCAD writes exactly this: an INSERT-like record plus table cell data)
        raw((0, "ACAD_TABLE"), (5, "FA01"), (330, "1F"), (100, "AcDbEntity"), (8, "A-ANNO-TEXT"), (100, "AcDbBlockReference"),
            (2, "*T1"), (10, cx - 100), (20, cy + 250), (30, 0.0), (100, "AcDbTable"), (280, 0), (342, "FB01"), (343, "FB02"),
            (11, 1.0), (21, 0.0), (31, 0.0), (90, 0), (91, len(TABLE_TEXTS)), (92, 1), (93, 0), (94, 0), (95, 0), (96, 0)),
        # OLE2FRAME
        raw((0, "OLE2FRAME"), (5, "FA02"), (330, "1F"), (100, "AcDbEntity"), (8, "A-OVERLAY"), (100, "AcDbOle2Frame"),
            (70, 2), (3, "Excel.Sheet.12"), (10, 4000.0), (20, 600.0), (30, 0.0), (11, 5500.0), (21, 1400.0), (31, 0.0),
            (71, 1), (72, 0), (73, 0), (90, 8), (310, "0123456789ABCDEF"), (1, "OLE")),
        # ACAD_PROXY_ENTITY with binary graphics/object data in group 310
        raw((0, "ACAD_PROXY_ENTITY"), (5, "FA03"), (330, "1F"), (100, "AcDbEntity"), (8, "A-OVERLAY"), (100, "AcDbProxyEntity"),
            (90, 498), (91, 500), (92, 16), (310, "4D45502D50524F5859000102030405060708090A0B0C0D0E0F"), (310, "FFEEDDCCBBAA99887766554433221100"),
            (93, 12), (95, 0), (96, 0), (97, 0)),
    ])
    with open(tmp, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    ents = [e for e in msp if e.dxftype() in SUPPORTED]
    unsupported = {}
    for e in msp:
        if e.dxftype() not in SUPPORTED and e.dxftype() != "INSERT":
            unsupported[e.dxftype()] = unsupported.get(e.dxftype(), 0) + 1
    unsupported.update({"ACAD_TABLE": 1, "OLE2FRAME": 1, "ACAD_PROXY_ENTITY": 1})
    arc_truth = []
    for e in msp:
        if e.dxftype() == "ARC":
            sp, ep = e.start_point, e.end_point
            arc_truth.append({"centre": [e.dxf.center.x, e.dxf.center.y], "radius": e.dxf.radius,
                              "startAngleDeg": e.dxf.start_angle, "endAngleDeg": e.dxf.end_angle,
                              "start": [sp.x, sp.y], "end": [ep.x, ep.y]})
    manifest["noise-2.dxf"] = {
        "item": "C5", "insunits": 4, "measurement": 1, "drawingUnit": "mm", "unitsPerFoot": MM_PER_FT,
        "expected": {"cadUnit": "mm", "unitsConfidence": "declared"},
        "expectedEntityCount": len(ents),
        "sourceUnsupported": unsupported,
        "paperSpaceSkipped": True,
        "xref": {"block": "SITE-PLAN", "path": XREF_PATH, "insertions": 1},
        "tableTexts": TABLE_TEXTS,
        "room": {"name": "OFFICE 1", "polygon": [c for p in room for c in p], "areaSqFt": poly_area(room) / MM_PER_FT ** 2},
        "arcs": arc_truth,
        "layers": {"tableCase": "WALLS", "entityCase": "walls", "wallAci": 1, "frozenTable": "A-FRZ", "frozenEntityCase": "a-frz",
                   "layerStateTurnsOff": "A-FURN"},
        "hiddenLayers": ["A-FRZ"],
        "headerTraps": {"ucsRotationDeg": 90, "angdir": 1, "angbaseRad": math.pi / 2, "insbase": [12345.0, 6789.0, 0.0]},
        "viewportTwistDeg": 33.0,
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    gen_line_endings(manifest)
    gen_noise2(manifest)
    doc = {
        "about": "Ground truth for the adversarial corpus, computed from the generator's construction geometry "
                 "(scripts/cad-corpus/generate_adversarial.py) and from ezdxf, never from our parser. "
                 "Coordinates are DXF drawing units, Y up; areas are net ft2.",
        "generator": {"ezdxf": ezdxf.__version__},
        "files": manifest,
    }
    here = os.path.join(os.path.dirname(OUT), "adversarial-manifest.json")
    with open(here, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False, sort_keys=True)
        fh.write("\n")
    for n in sorted(manifest):
        print(n)


if __name__ == "__main__":
    main()
