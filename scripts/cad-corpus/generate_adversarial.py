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


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    gen_line_endings(manifest)
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
