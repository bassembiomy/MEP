#!/usr/bin/env python3
"""Independent-writer CAD corpus for the MEP importer tests.

Regenerate with:  python3 scripts/cad-corpus/generate_corpus.py      (requires ezdxf==1.4.4)
                  python3 scripts/cad-corpus/generate_corpus.py --r2000-twins   (R2000 DXF twins in fixtures/corpus/dwg/)

The DXF files are written by ezdxf, an independent DXF writer, and manifest.json holds GROUND TRUTH computed
from the construction geometry below. It is never computed from, or compared against, our own parser's output.
All manifest coordinates are DXF drawing units with Y pointing UP (our parser flips Y; the tests negate).
"""
import gzip
import io
import json
import math
import os
import re
import sys

if os.environ.get("PYTHONHASHSEED") != "0":  # ezdxf's OBJECTS order follows set iteration; pin it for byte-stable output
    os.environ["PYTHONHASHSEED"] = "0"
    os.execv(sys.executable, [sys.executable, os.path.abspath(__file__)] + sys.argv[1:])

import ezdxf
from ezdxf import units as ez_units
from ezdxf.bbox import extents as ez_extents

if ezdxf.__version__ != "1.4.4":
    sys.exit(f"ezdxf 1.4.4 required (found {ezdxf.__version__}): pip install ezdxf==1.4.4")
ezdxf.options.write_fixed_meta_data_for_testing = True  # byte-stable output

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "src", "renderer", "src", "engine",
                   "__tests__", "fixtures", "corpus")
OUT = os.path.normpath(OUT)
MM_PER_FT = 304.8
SUPPORTED = {"LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC", "ELLIPSE", "TEXT", "MTEXT"}


# --------------------------------------------------------------------------------------------- helpers
def out_name(name):
    """Twin mode: arch-metric-mm-r2018.dxf -> arch-metric-mm-r2000.dxf (the construction geometry is identical)."""
    if not TWIN_VERSION:
        return name
    stem = name[:-4]
    stem = re.sub(r"-r20\d\d.*$", "", stem)
    return f"{stem}-r2000.dxf"


def poly_area(pts):
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def flat(pts):
    return [c for p in pts for c in p]


TWIN_VERSION = None  # set by --r2000-twins: every gen_* writes an R2000 document into OUT_DIR under a twin name
OUT_DIR = None


def new_doc(version, unit_code, measurement, lunits, codepage=None):
    doc = ezdxf.new(TWIN_VERSION or version, setup=True)
    doc.units = unit_code
    doc.header["$MEASUREMENT"] = measurement
    doc.header["$LUNITS"] = lunits
    if codepage:
        doc.header["$DWGCODEPAGE"] = codepage
    return doc


def add_layers(doc, names, off=(), frozen=()):
    for i, n in enumerate(names):
        if n not in doc.layers:
            doc.layers.add(n, color=(i % 7) + 1)
    for n in off:
        doc.layers.get(n).off()
    for n in frozen:
        doc.layers.get(n).freeze()


def door_block(doc, name="DOOR-SGL-900", radius=900, attdef=True):
    """Hinge at the block origin, closed leaf along +X, open leaf LINE along +Y, 90 degree swing ARC."""
    b = doc.blocks.new(name)
    b.add_line((0, 0), (0, radius))
    b.add_arc((0, 0), radius, 0, 90)
    if attdef:
        b.add_attdef("TAG", (radius / 2, radius / 2), "D00", dxfattribs={"height": radius / 9})
    return b


def window_block(doc, name="WIN-1200", width=1200, wall=200):
    b = doc.blocks.new(name)
    for y in (0, wall / 2, wall):
        b.add_line((0, y), (width, y))
    return b


def desk_block(doc, name="DESK-1200", w=1200, d=600):
    b = doc.blocks.new(name)
    b.add_lwpolyline(rect(0, 0, w, d), close=True)
    for x in (w * 0.1, w * 0.9):
        b.add_line((x, 0), (x, d))
    b.add_line((w * 0.1, d / 2), (w * 0.9, d / 2))
    return b


def chair_block(doc, name="CHAIR-400", r=200):
    b = doc.blocks.new(name)
    b.add_circle((0, 0), r)
    b.add_arc((0, 0), r * 1.3, 200, 340)
    b.add_line((-r, r * 1.3), (r, r * 1.3))
    b.add_line((-r, r * 1.3), (-r, r * 1.6))
    return b


def door_hinge(cx, cy, width, rot, mirrored):
    """Insertion (hinge) point so the leaf spans width centred on (cx, cy)."""
    th = math.radians(rot)
    sx = -1 if mirrored else 1
    dx, dy = math.cos(th) * sx * width, math.sin(th) * sx * width
    return (cx - dx / 2, cy - dy / 2)


def wall_pieces(lo, hi, gaps):
    """Pieces of [lo, hi] left after removing sorted gaps."""
    out, cur = [], lo
    for g0, g1 in sorted(gaps):
        if g0 > cur:
            out.append((cur, g0))
        cur = max(cur, g1)
    if hi > cur:
        out.append((cur, hi))
    return out


class Wall:
    """Emit wall face lines with door/window gaps and jamb caps on layer A-WALL."""

    def __init__(self, msp, layer="A-WALL", z=0.0):
        self.msp, self.layer, self.z = msp, layer, z

    def line(self, p, q):
        self.msp.add_line((p[0], p[1], self.z), (q[0], q[1], self.z), dxfattribs={"layer": self.layer})

    def face_h(self, y, x0, x1, gaps=()):
        for a, b in wall_pieces(x0, x1, gaps):
            self.line((a, y), (b, y))

    def face_v(self, x, y0, y1, gaps=()):
        for a, b in wall_pieces(y0, y1, gaps):
            self.line((x, a), (x, b))

    def caps_h(self, ya, yb, gaps):  # wall runs along X; caps are vertical
        for g0, g1 in gaps:
            self.line((g0, ya), (g0, yb))
            self.line((g1, ya), (g1, yb))

    def caps_v(self, xa, xb, gaps):  # wall runs along Y; caps are horizontal
        for g0, g1 in gaps:
            self.line((xa, g0), (xb, g0))
            self.line((xa, g1), (xb, g1))


def mtext(msp, text, x, y, h, layer, z=0.0):
    m = msp.add_mtext(text, dxfattribs={"layer": layer, "char_height": h, "attachment_point": 5, "insert": (x, y, z)})
    return m


def count_supported(doc, entities, exclude_handles=()):
    """Entity count the importer should produce, derived from the ezdxf document (INSERTs expanded)."""
    def block_count(name, seen=()):
        n = 0
        for e in doc.blocks.get(name):
            t = e.dxftype()
            if t in SUPPORTED:
                n += 1
            elif t == "INSERT":
                n += block_count(e.dxf.name, seen + (name,))
        return n

    total = 0
    for e in entities:
        if e.dxf.handle in exclude_handles:
            continue
        t = e.dxftype()
        if t in SUPPORTED:
            total += 1
        elif t == "INSERT":
            total += block_count(e.dxf.name)
    return total


def count_unsupported(doc, entities):
    """Source entities our importer is documented/expected NOT to turn into geometry, by DXF type."""
    out = {}

    def add(t, n=1):
        out[t] = out.get(t, 0) + n

    def walk_block(name):
        for e in doc.blocks.get(name):
            t = e.dxftype()
            if t == "INSERT":
                walk_block(e.dxf.name)
            elif t not in SUPPORTED:
                add(t)

    for e in entities:
        t = e.dxftype()
        if t == "INSERT":
            walk_block(e.dxf.name)
            if e.attribs:
                add("ATTRIB", len(e.attribs))
                add("SEQEND")
        elif t not in SUPPORTED:
            add(t)
    return out


def model_bbox(msp):
    """Geometry extents of what the importer can draw (text counts as its anchor point only)."""
    xs, ys = [], []

    def feed(e):
        t = e.dxftype()
        if t in ("TEXT", "MTEXT"):
            p = e.dxf.insert
            xs.append(p.x), ys.append(p.y)
        elif t in ("LINE", "LWPOLYLINE", "CIRCLE", "ARC", "ELLIPSE", "POLYLINE"):
            bb = ez_extents([e])
            if bb.has_data:
                xs.extend([bb.extmin.x, bb.extmax.x]), ys.extend([bb.extmin.y, bb.extmax.y])
        elif t == "INSERT":
            for v in e.virtual_entities():
                feed(v)

    for e in msp:
        feed(e)
    return {"minX": min(xs), "maxX": max(xs), "minY": min(ys), "maxY": max(ys)}


# ------------------------------------------------------------------------------- the metric office plan
# Clear (finished-face) rooms in mm. Exterior walls 200 thick, interior partitions 100 thick.
ROOMS_MM = [
    ("OFFICE 1", rect(0, 0, 4000, 5000), "{\\fArial|b1;OFFICE 1}", "CH 2700", 2.70),
    ("OFFICE 2", rect(4100, 0, 8100, 5000), "{\\fArial|b1;OFFICE 2}", "C.H. = 2.70 m", 2.70),
    ("MEETING ROOM", rect(8200, 0, 14200, 5000), "{\\fArial|b1;MEETING ROOM}", "CH 3000", 3.00),
    ("CORRIDOR", rect(0, 5100, 14200, 7100), "{\\fArial|b1;CORRIDOR}", "C.H. = 2.40 m", 2.40),
]
DOORS_MM = [  # (id, gap centre, rotation, mirrored, wall)
    ("D01", (2000, 5050), 0, False),
    ("D02", (6100, 5050), 180, False),
    ("D03", (11200, 5050), 0, True),
    ("D04", (-100, 6100), 270, False),
    ("D05", (14300, 6100), 90, False),
]
WINDOWS_MM = [(2000, -100), (6100, -100), (11200, -100)]  # gap centres on the bottom exterior wall


def room_truth_mm(with_text=True):
    out = []
    for name, poly, _raw, ch_text, ch_m in ROOMS_MM:
        out.append({
            "name": name,
            "polygon": flat(poly),
            "areaSqFt": poly_area(poly) / MM_PER_FT ** 2,
            "ceilingAnnotation": ch_text,
            "ceilingHeightFt": ch_m / 0.3048,
        })
    return out


def build_metric_plan(doc, msp, attribs=True, text=True, furniture=True, door_attdef=True):
    """Draw the 4-room plan. Returns ground truth for openings/columns."""
    add_layers(doc, ["A-WALL", "A-DOOR", "A-GLAZ", "S-COLS", "A-ANNO-TEXT", "A-AREA", "A-FURN"])
    door_block(doc, attdef=door_attdef)
    window_block(doc)
    w = Wall(msp)
    win_gaps = [(cx - 600, cx + 600) for cx, _ in WINDOWS_MM]
    d_h = [(cx - 450, cx + 450) for _, (cx, cy), _, _ in DOORS_MM if cy == 5050]
    # exterior bottom (windows)
    w.face_h(0, 0, 14200, win_gaps), w.face_h(-200, -200, 14400, win_gaps), w.caps_h(-200, 0, win_gaps)
    # exterior left/right (corridor doors D04/D05), top (solid)
    for x_in, x_out in ((0, -200), (14200, 14400)):
        w.face_v(x_in, 0, 7100, [(5650, 6550)]), w.face_v(x_out, -200, 7300, [(5650, 6550)])
        w.caps_v(x_out, x_in, [(5650, 6550)])
    w.face_h(7100, 0, 14200), w.face_h(7300, -200, 14400)
    # horizontal partition between rooms and corridor: faces y=5000 (3 pieces) and y=5100
    d1, d2, d3 = d_h
    for x0, x1, g in ((0, 4000, d1), (4100, 8100, d2), (8200, 14200, d3)):
        w.face_h(5000, x0, x1, [g])
    w.face_h(5100, 0, 14200, d_h)
    w.caps_h(5000, 5100, d_h)
    # vertical partitions (two faces each) between the rooms
    for xa, xb in ((4000, 4100), (8100, 8200)):
        w.face_v(xa, 0, 5000), w.face_v(xb, 0, 5000)
    # openings
    openings = []
    for did, (cx, cy), rot, mir in DOORS_MM:
        ins = door_hinge(cx, cy, 900, rot, mir)
        ref = msp.add_blockref("DOOR-SGL-900", ins, dxfattribs={"layer": "A-DOOR", "rotation": rot,
                                                                   "xscale": -1 if mir else 1})
        if attribs and door_attdef:
            ref.add_auto_attribs({"TAG": did})
        openings.append({"kind": "door", "id": did, "centre": {"x": cx, "y": cy}, "widthMm": 900,
                         "widthFt": 900 / MM_PER_FT, "block": "DOOR-SGL-900", "rotationDeg": rot, "mirrored": mir,
                         "hinge": {"x": ins[0], "y": ins[1]}})
    for cx, cy in WINDOWS_MM:
        msp.add_blockref("WIN-1200", (cx - 600, -200), dxfattribs={"layer": "A-GLAZ"})
        openings.append({"kind": "window", "id": f"W@{cx}", "centre": {"x": cx, "y": cy}, "widthMm": 1200,
                         "widthFt": 1200 / MM_PER_FT, "block": "WIN-1200", "rotationDeg": 0, "mirrored": False})
    # room boundaries + labels
    for name, poly, raw, ch_text, _ in ROOMS_MM:
        msp.add_lwpolyline(poly, close=True, dxfattribs={"layer": "A-AREA"})
        if text:
            cx = (poly[0][0] + poly[2][0]) / 2
            cy = (poly[0][1] + poly[2][1]) / 2
            mtext(msp, raw, cx, cy + 300, 250, "A-ANNO-TEXT")
            mtext(msp, ch_text, cx, cy - 300, 150, "A-ANNO-TEXT")
    # columns
    cols = [("square", (9500, 2500), 400), ("square", (12900, 2500), 400), ("circle", (6100, 6100), 450)]
    for shape, (cx, cy), size in cols:
        if shape == "square":
            h = size / 2
            msp.add_lwpolyline(rect(cx - h, cy - h, cx + h, cy + h), close=True, dxfattribs={"layer": "S-COLS"})
        else:
            msp.add_circle((cx, cy), size / 2, dxfattribs={"layer": "S-COLS"})
    columns = [{"shape": s, "centre": {"x": c[0], "y": c[1]}, "sizeMm": z, "sizeFt": z / MM_PER_FT} for s, c, z in cols]
    if furniture:
        desk_block(doc)
        msp.add_blockref("DESK-1200", (500, 3500), dxfattribs={"layer": "A-FURN"})
        msp.add_blockref("DESK-1200", (4600, 3500), dxfattribs={"layer": "A-FURN", "rotation": 90})
    return openings, columns


def metric_file_truth(doc, msp, openings, columns, unit_name, unit_code, measurement, **extra):
    ents = list(msp)
    t = {
        "dxfVersion": doc.dxfversion,
        "insunits": unit_code, "measurement": measurement, "drawingUnit": unit_name,
        "unitsPerFoot": MM_PER_FT,
        "rooms": room_truth_mm(), "openings": openings, "columns": columns,
        "modelBBox": model_bbox(msp),
        "expectedEntityCount": count_supported(doc, ents),
        "sourceUnsupported": count_unsupported(doc, ents),
    }
    t.update(extra)
    return t


# --------------------------------------------------------------------------------------------- files
def gen_metric(manifest):
    doc = new_doc("R2018", ez_units.MM, 1, 2)
    msp = doc.modelspace()
    openings, cols = build_metric_plan(doc, msp)
    name = out_name("arch-metric-mm-r2018.dxf")
    doc.saveas(os.path.join(OUT_DIR or OUT, name))
    manifest[name] = metric_file_truth(doc, msp, openings, cols, "mm", 4, 1,
                                       expected={"cadUnit": "mm", "unitsConfidence": "declared"},
                                       wallSegments=sum(1 for e in msp if e.dxftype() == "LINE" and e.dxf.layer == "A-WALL"))


def gen_unitless(manifest):
    doc = new_doc("R2013", 0, 1, 2)
    msp = doc.modelspace()
    openings, cols = build_metric_plan(doc, msp, attribs=False, door_attdef=False, furniture=False)
    name = out_name("unitless-insunits0.dxf")
    doc.saveas(os.path.join(OUT_DIR or OUT, name))
    manifest[name] = metric_file_truth(doc, msp, openings, cols, "mm (undeclared)", 0, 1,
                                       expected={"cadUnit": "mm", "unitsConfidence": "unknown"})


def gen_imperial(manifest):
    doc = new_doc("R2010", ez_units.IN, 0, 4)
    msp = doc.modelspace()
    add_layers(doc, ["A-WALL", "A-DOOR", "A-ANNO-TEXT", "A-AREA"])
    door_block(doc, "DOOR-36", radius=36)
    # centreline rooms, inches (12 in/ft)
    rooms = [
        ("OFFICE A", rect(0, 0, 144, 168), "OFFICE A", "CLG HT 9'-0\"", 9.0),
        ("OFFICE B", rect(144, 0, 288, 168), "OFFICE B", "CLG HT 9'-0\"", 9.0),
        ("CONFERENCE", rect(288, 0, 480, 168), "CONFERENCE", "CH 8'-6\"", 8.5),
        ("LOBBY", rect(0, 168, 480, 264), "LOBBY", "CH 8'-6\"", 8.5),
    ]
    w = Wall(msp)
    d_h = [(54, 90), (198, 234), (366, 402)]
    w.face_h(0, 0, 480), w.face_h(264, 0, 480)
    w.face_v(0, 0, 264, [(192, 228)]), w.face_v(480, 0, 264, [(192, 228)])
    w.face_h(168, 0, 480, d_h)
    w.face_v(144, 0, 168), w.face_v(288, 0, 168)
    doors = [("D01", (72, 168), 0, False), ("D02", (216, 168), 180, False), ("D03", (384, 168), 0, True),
             ("D04", (0, 210), 270, False), ("D05", (480, 210), 90, False)]
    openings = []
    for did, (cx, cy), rot, mir in doors:
        ins = door_hinge(cx, cy, 36, rot, mir)
        ref = msp.add_blockref("DOOR-36", ins, dxfattribs={"layer": "A-DOOR", "rotation": rot, "xscale": -1 if mir else 1})
        ref.add_auto_attribs({"TAG": did})
        openings.append({"kind": "door", "id": did, "centre": {"x": cx, "y": cy}, "widthIn": 36, "widthFt": 3.0,
                         "block": "DOOR-36", "rotationDeg": rot, "mirrored": mir})
    room_truth = []
    for name, poly, raw, ch, ch_ft in rooms:
        msp.add_lwpolyline(poly, close=True, dxfattribs={"layer": "A-AREA"})
        cx, cy = (poly[0][0] + poly[2][0]) / 2, (poly[0][1] + poly[2][1]) / 2
        mtext(msp, raw, cx, cy + 12, 8, "A-ANNO-TEXT")
        mtext(msp, ch, cx, cy - 12, 5, "A-ANNO-TEXT")
        room_truth.append({"name": name, "polygon": flat(poly), "areaSqFt": poly_area(poly) / 144.0,
                           "ceilingAnnotation": ch, "ceilingHeightFt": ch_ft})
    name = out_name("arch-imperial-in-r2010.dxf")
    doc.saveas(os.path.join(OUT_DIR or OUT, name))
    ents = list(msp)
    manifest[name] = {
        "dxfVersion": doc.dxfversion, "insunits": 1, "measurement": 0, "lunits": 4, "drawingUnit": "in",
        "unitsPerFoot": 12.0, "rooms": room_truth, "openings": openings, "columns": [],
        "modelBBox": model_bbox(msp), "expectedEntityCount": count_supported(doc, ents),
        "sourceUnsupported": count_unsupported(doc, ents),
        "expected": {"cadUnit": "in", "unitsConfidence": "declared"},
    }


def gen_noise(manifest):
    doc = new_doc("R2018", ez_units.MM, 1, 2)
    msp = doc.modelspace()
    openings, cols = build_metric_plan(doc, msp, attribs=False, door_attdef=False, furniture=False)
    add_layers(doc, ["Defpoints", "A-DIMS", "A-HATCH", "A-FRZ", "A-OFF", "A-WALL-CURVE"], off=["A-OFF"], frozen=["A-FRZ"])
    doc.appids.add("MEPTEST")
    # linear dimensions (anonymous *D blocks)
    for i, (x0, x1) in enumerate(((0, 4000), (4100, 8100), (8200, 14200))):
        d = msp.add_linear_dim(base=(0, -1200 - 400 * i), p1=(x0, 0), p2=(x1, 0),
                               dimstyle="EZDXF", dxfattribs={"layer": "A-DIMS"})
        d.render()
    if not TWIN_VERSION:
        # The rotated (vertical) dimension is omitted from the R2000 twin: LibreDWG 0.13.3's DXF reader rejects the
        # MTEXT group 50 (rotation) that ezdxf writes inside its anonymous *D block ("Invalid DXF code 50 for MTEXT").
        msp.add_linear_dim(base=(-1200, 0), p1=(0, 0), p2=(0, 5000), angle=90, dimstyle="EZDXF",
                           dxfattribs={"layer": "A-DIMS"}).render()
    # Defpoints (what AutoCAD leaves behind for dimensions)
    for p in ((0, 0), (4000, 0), (14200, 0)):
        msp.add_point(p, dxfattribs={"layer": "Defpoints"})
    # hatches in wall bodies: solid in the 100 mm partition x=4000..4100, ANSI31 in the 200 mm exterior top wall
    h = msp.add_hatch(color=8, dxfattribs={"layer": "A-HATCH"})
    h.paths.add_polyline_path(rect(4000, 0, 4100, 5000), is_closed=True)
    h2 = msp.add_hatch(color=7, dxfattribs={"layer": "A-HATCH"})
    h2.set_pattern_fill("ANSI31", scale=50)
    h2.paths.add_polyline_path(rect(0, 7100, 14200, 7300), is_closed=True)
    # curved feature wall: SPLINE (inside the plan extents) + an ELLIPSE (a supported entity)
    msp.add_spline(fit_points=[(9000, 4500), (10500, 4100), (12000, 4500), (13200, 4000)],
                   dxfattribs={"layer": "A-WALL-CURVE"})
    msp.add_ellipse((6100, 2500), major_axis=(700, 0, 0), ratio=0.5, dxfattribs={"layer": "A-FURN"})
    # XDATA on a few walls
    n = 0
    for e in msp:
        if e.dxftype() == "LINE" and e.dxf.layer == "A-WALL" and n < 6:
            e.set_xdata("MEPTEST", [(1000, f"wall-{n}"), (1040, 3.5), (1070, n)])
            n += 1
    # frozen and off layers: construction lines inside the plan
    msp.add_line((500, 2500), (3500, 2500), dxfattribs={"layer": "A-FRZ"})
    msp.add_line((500, 2600), (3500, 2600), dxfattribs={"layer": "A-OFF"})
    # PAPER SPACE: title block on Layout1, a viewport on a second layout
    l1 = doc.layout("Layout1")
    for (a, b) in (((0, 0), (420, 0)), ((420, 0), (420, 297)), ((420, 297), (0, 297)), ((0, 297), (0, 0))):
        l1.add_line(a, b)
    l1.add_text("TITLE BLOCK", dxfattribs={"insert": (300, 20), "height": 8})
    l2 = doc.layouts.new("Layout2")
    l2.add_viewport(center=(210, 148), size=(380, 250), view_center_point=(7100, 3500), view_height=9000)
    l2.add_line((10, 10), (410, 10))
    name = out_name("noise-dim-hatch-spline-paper.dxf")
    doc.saveas(os.path.join(OUT_DIR or OUT, name))
    ents = list(msp)
    hidden = [e for e in ents if e.dxf.layer in ("A-FRZ", "A-OFF")]
    manifest[name] = metric_file_truth(
        doc, msp, openings, cols, "mm", 4, 1,
        expected={"cadUnit": "mm", "unitsConfidence": "declared"},
        hiddenLayers=["A-FRZ", "A-OFF"], hiddenLayerEntityCount=len(hidden),
        paperSpace={"layout1Entities": 5, "layout1Texts": ["TITLE BLOCK"], "layout2Viewports": 1},
        splineCount=1, ellipseCount=1)


def gen_elevated(manifest):
    doc = new_doc("R2013", ez_units.MM, 1, 2)
    msp = doc.modelspace()
    add_layers(doc, ["A-WALL", "A-DOOR", "A-AREA", "A-ANNO-TEXT"])
    door_block(doc, attdef=False)
    Z = 3500
    levels = {0: [], Z: []}
    plans = {
        0: [("GF OFFICE", rect(0, 0, 4000, 5000), "CH 2700", 2.70), ("GF STORE", rect(4100, 0, 7100, 4000), "CH 2400", 2.40)],
        Z: [("UF OPEN OFFICE", rect(0, 0, 5000, 5000), "CH 2800", 2.80), ("UF MEETING", rect(5100, 0, 9100, 4000), "CH 3000", 3.00)],
    }
    elevated_top_level = 0
    for z, rooms in plans.items():
        wall = Wall(msp, z=z)
        for name, poly, ch, ch_m in rooms:
            (x0, y0), (x1, y1) = poly[0], poly[2]
            door_gap = [((x0 + x1) / 2 - 450, (x0 + x1) / 2 + 450)]
            wall.face_h(y0, x0, x1), wall.face_h(y1, x0, x1, door_gap), wall.face_v(x0, y0, y1), wall.face_v(x1, y0, y1)
            msp.add_lwpolyline(poly, close=True, dxfattribs={"layer": "A-AREA", "elevation": z})
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            msp.add_text(name, dxfattribs={"layer": "A-ANNO-TEXT", "insert": (cx, cy + 300, z), "height": 250})
            msp.add_text(ch, dxfattribs={"layer": "A-ANNO-TEXT", "insert": (cx, cy - 300, z), "height": 150})
            ins = ((x0 + x1) / 2 - 450, y1, z)
            msp.add_blockref("DOOR-SGL-900", ins, dxfattribs={"layer": "A-DOOR"})
            levels[z].append({
                "name": name, "polygon": flat(poly), "areaSqFt": poly_area(poly) / MM_PER_FT ** 2,
                "ceilingAnnotation": ch, "ceilingHeightFt": ch_m / 0.3048,
                "door": {"x": (x0 + x1) / 2, "y": y1, "widthFt": 900 / MM_PER_FT},
            })
    # one non-planar 3D line (varies in Z): must be dropped
    msp.add_line((100, 100, 0), (4000, 4000, 3500), dxfattribs={"layer": "A-WALL"})
    name = out_name("elevated-levels.dxf")
    doc.saveas(os.path.join(OUT_DIR or OUT, name))
    ents = list(msp)
    nonplanar = [e for e in ents if e.dxftype() == "LINE" and e.dxf.start.z != e.dxf.end.z]
    elevated = [e for e in ents if e.dxftype() != "LINE" or e.dxf.start.z == e.dxf.end.z]
    elevated_top = 0
    for e in elevated:
        t = e.dxftype()
        z = e.dxf.elevation if t == "LWPOLYLINE" else (e.dxf.insert.z if t in ("INSERT", "TEXT") else (e.dxf.start.z if t == "LINE" else 0))
        if z != 0:
            elevated_top += 1
    manifest[name] = {
        "dxfVersion": doc.dxfversion, "insunits": 4, "measurement": 1, "drawingUnit": "mm", "unitsPerFoot": MM_PER_FT,
        "expected": {"cadUnit": "mm", "unitsConfidence": "declared"},
        "levels": {str(int(z)): rooms for z, rooms in levels.items()},
        "nonPlanarLines": len(nonplanar),
        "elevatedTopLevelEntities": elevated_top,
        "modelBBox": {"minX": 0, "maxX": 9100, "minY": 0, "maxY": 5000 + 450},  # replaced below with computed bbox
        "expectedEntityCount": count_supported(doc, ents, exclude_handles={e.dxf.handle for e in nonplanar}),
        "sourceUnsupported": count_unsupported(doc, ents),
        "rooms": [], "openings": [], "columns": [],
    }
    bb = model_bbox_excluding(msp, nonplanar)
    manifest[name]["modelBBox"] = bb


def model_bbox_excluding(msp, excluded):
    ids = {e.dxf.handle for e in excluded}
    xs, ys = [], []

    def feed(e):
        t = e.dxftype()
        if t in ("TEXT", "MTEXT"):
            p = e.dxf.insert
            xs.append(p.x), ys.append(p.y)
        elif t in ("LINE", "LWPOLYLINE", "CIRCLE", "ARC", "ELLIPSE"):
            bb = ez_extents([e])
            if bb.has_data:
                xs.extend([bb.extmin.x, bb.extmax.x]), ys.extend([bb.extmin.y, bb.extmax.y])
        elif t == "INSERT":
            for v in e.virtual_entities():
                feed(v)

    for e in msp:
        if e.dxf.handle not in ids:
            feed(e)
    return {"minX": min(xs), "maxX": max(xs), "minY": min(ys), "maxY": max(ys)}


def gen_large(manifest):
    doc = new_doc("R2018", ez_units.MM, 1, 2)
    msp = doc.modelspace()
    add_layers(doc, ["A-WALL", "A-DOOR", "A-AREA", "A-ANNO-TEXT", "A-FURN", "A-FLOR-PATT"])
    door_block(doc, attdef=False)
    desk_block(doc)
    chair_block(doc)
    COLS, ROWS = 8, 6
    PX, PY = 6400, 4400
    FLOOR_LINES = 324
    rooms, wall_segments, area_segments = [], 0, 0
    w = Wall(msp)
    n = 0
    for r in range(ROWS):
        for c in range(COLS):
            n += 1
            ox, oy = c * PX, r * PY
            rw, rh = 4000 + 250 * c, 3800 + 100 * r
            poly = rect(ox, oy, ox + rw, oy + rh)
            gap = [(ox + 1000, ox + 1900)]
            w.face_h(oy, ox, ox + rw, gap), w.face_h(oy + rh, ox, ox + rw)
            w.face_v(ox, oy, oy + rh), w.face_v(ox + rw, oy, oy + rh)
            wall_segments += len(wall_pieces(ox, ox + rw, gap)) + 3
            msp.add_lwpolyline(poly, close=True, dxfattribs={"layer": "A-AREA"})
            area_segments += 4
            msp.add_blockref("DOOR-SGL-900", (ox + 1000, oy), dxfattribs={"layer": "A-DOOR"})
            nm = f"BAY {n:02d}"
            cx, cy = ox + rw / 2, oy + rh / 2
            mtext(msp, "{\\fArial|b1;" + nm + "}", cx, cy + 300, 250, "A-ANNO-TEXT")
            mtext(msp, "CH 2700", cx, cy - 300, 150, "A-ANNO-TEXT")
            for i in range(10):  # desks (2 columns x 5 rows) and chairs
                dx = ox + 300 + (i % 2) * 1300
                dy = oy + 500 + (i // 2) * 650
                msp.add_blockref("DESK-1200", (dx, dy), dxfattribs={"layer": "A-FURN"})
                msp.add_blockref("CHAIR-400", (dx + 600, dy - 150 if i // 2 else dy + 750), dxfattribs={"layer": "A-FURN"})
            for k in range(FLOOR_LINES):  # raised-floor pattern, direct entities
                x = ox + 100 + (k % 54) * ((rw - 200) / 54)
                y0 = oy + 100 + (k // 54) * ((rh - 200) / 6)
                msp.add_line((x, y0), (x, y0 + (rh - 200) / 7), dxfattribs={"layer": "A-FLOR-PATT"})
            rooms.append({"name": nm, "polygon": flat(poly), "areaSqFt": poly_area(poly) / MM_PER_FT ** 2,
                          "ceilingAnnotation": "CH 2700", "ceilingHeightFt": 2.7 / 0.3048})
    name = "large-office-20k.dxf.gz"
    buf = io.StringIO()
    doc.write(buf)
    raw = buf.getvalue().encode("utf-8")
    with open(os.path.join(OUT, name), "wb") as fh:
        with gzip.GzipFile(filename="", mode="wb", fileobj=fh, mtime=0, compresslevel=9) as gz:
            gz.write(raw)
    ents = list(msp)
    manifest[name] = {
        "dxfVersion": doc.dxfversion, "insunits": 4, "measurement": 1, "drawingUnit": "mm", "unitsPerFoot": MM_PER_FT,
        "expected": {"cadUnit": "mm", "unitsConfidence": "declared"},
        "rawBytes": len(raw), "bays": n,
        "rooms": rooms, "openings": [], "columns": [],
        "modelBBox": model_bbox(msp), "expectedEntityCount": count_supported(doc, ents),
        "sourceUnsupported": count_unsupported(doc, ents),
        "wallSegments": {"A-WALL": wall_segments, "A-AREA": area_segments,
                         "note": "line segments recognizeCadRooms receives per layer; limit is 5000"},
    }


def gen_legacy(manifest):
    doc = new_doc("R2000", ez_units.MM, 1, 2, codepage="ANSI_1252")
    msp = doc.modelspace()
    add_layers(doc, ["A-AREA", "A-ANNO-TEXT"])
    rooms = [
        ("Büro", rect(0, 0, 5000, 4000), "Büro", None),
        ("Café", rect(5100, 0, 10100, 4000), "Café", "CH 2700"),
    ]
    arabic = "ارتفاع السقف 2.80"
    truth = []
    for name, poly, label, ch in rooms:
        msp.add_lwpolyline(poly, close=True, dxfattribs={"layer": "A-AREA"})
        cx, cy = (poly[0][0] + poly[2][0]) / 2, (poly[0][1] + poly[2][1]) / 2
        mtext(msp, label, cx, cy + 300, 250, "A-ANNO-TEXT")
        if ch:
            mtext(msp, ch, cx, cy - 300, 150, "A-ANNO-TEXT")
            h = 2.70
        else:
            mtext(msp, arabic, cx, cy - 300, 150, "A-ANNO-TEXT")
            h = 2.80
        truth.append({"name": name, "polygon": flat(poly), "areaSqFt": poly_area(poly) / MM_PER_FT ** 2,
                      "ceilingAnnotation": ch or arabic, "ceilingHeightFt": h / 0.3048})
    name = out_name("legacy-r2000-cp1252.dxf")
    doc.saveas(os.path.join(OUT_DIR or OUT, name))
    ents = list(msp)
    manifest[name] = {
        "dxfVersion": doc.dxfversion, "insunits": 4, "measurement": 1, "drawingUnit": "mm", "unitsPerFoot": MM_PER_FT,
        "expected": {"cadUnit": "mm", "unitsConfidence": "declared"},
        "encoding": "cp1252 (DWGCODEPAGE ANSI_1252); non-cp1252 characters are written as \\U+XXXX",
        "rooms": truth, "openings": [], "columns": [], "modelBBox": model_bbox(msp),
        "expectedEntityCount": count_supported(doc, ents), "sourceUnsupported": count_unsupported(doc, ents),
    }


TWIN_SOURCES = (gen_metric, gen_imperial, gen_unitless, gen_noise, gen_elevated)


def main_twins():
    """R2000 DXF twins (same construction geometry, DXF version AC1015) for the DWG corpus.

    They are the inputs of generate_dwg_corpus.py (dxf2dwg --as r2000). Ground truth for each twin is the same
    construction truth as its R2018/R2010/R2013 original, recomputed here from the ezdxf document, never from our parser."""
    global TWIN_VERSION, OUT_DIR
    TWIN_VERSION, OUT_DIR = "R2000", os.path.join(OUT, "dwg")
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {}
    for gen in TWIN_SOURCES:
        gen(manifest)
    doc = {
        "about": "Ground truth for the R2000 DXF twins of the corpus, computed from the generator's construction geometry "
                 "(scripts/cad-corpus/generate_corpus.py --r2000-twins), never from our parser. Same conventions as ../manifest.json.",
        "generator": {"ezdxf": ezdxf.__version__},
        "files": manifest,
    }
    with open(os.path.join(OUT_DIR, "twins-manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False, sort_keys=True)
        fh.write("\n")
    for n in sorted(manifest):
        print(n, os.path.getsize(os.path.join(OUT_DIR, n)), "bytes; expected entities", manifest[n]["expectedEntityCount"])


def main():
    if "--r2000-twins" in sys.argv[1:]:
        return main_twins()
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    gen_metric(manifest)
    gen_imperial(manifest)
    gen_unitless(manifest)
    gen_noise(manifest)
    gen_elevated(manifest)
    gen_large(manifest)
    gen_legacy(manifest)
    doc = {
        "about": "Ground truth computed from the generator's construction geometry (scripts/cad-corpus/generate_corpus.py), "
                 "never from our parser. Coordinates are DXF drawing units, Y up; areas are net ft2.",
        "generator": {"ezdxf": ezdxf.__version__},
        "files": manifest,
    }
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False, sort_keys=True)
        fh.write("\n")
    for n in sorted(manifest):
        print(n, os.path.getsize(os.path.join(OUT, n)), "bytes; expected entities", manifest[n]["expectedEntityCount"])


if __name__ == "__main__":
    main()
