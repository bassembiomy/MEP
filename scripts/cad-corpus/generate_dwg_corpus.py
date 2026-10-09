#!/usr/bin/env python3
"""Binary DWG corpus: R2000 DXF twins (ezdxf) -> native LibreDWG `dxf2dwg` -> committed .dwg + dwg-manifest.json.

    scripts/cad-corpus/build_libredwg.sh                      # once: builds LibreDWG 0.13.3 outside the repo
    python3 scripts/cad-corpus/generate_corpus.py --r2000-twins
    python3 scripts/cad-corpus/generate_dwg_corpus.py [--versions r2000,r14,r2004]      (npm run corpus:generate-dwg)

Why a WRITER CHECK: dxf2dwg is a third-party writer and could silently drop or corrupt data. Every produced DWG is
read back by LibreDWG's own `dwg2dxf` and compared with the ezdxf source document (entity counts by type and by
layer, paper space, INSERT attributes, layer table flags, $INSUNITS/$MEASUREMENT/$LUNITS, block names). Neither our
parsers nor libredwg-web are involved. A (file, version) pair that differs is NOT written; the differences go into
the manifest's `rejected` list so the loss is documented, never hidden. Expected losses (e.g. entity types the
writer cannot round-trip) are recorded under `exclusions` only for types in KNOWN_LOSS_TYPES.

Tests only read the committed files; they never need Python or the native build.
The .dwg bytes are NOT reproducible (LibreDWG stamps the file); dwg-manifest.json records the sha256 of the committed files.
"""
import collections
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

if os.environ.get("PYTHONHASHSEED") != "0":
    os.environ["PYTHONHASHSEED"] = "0"
    os.execv(sys.executable, [sys.executable, os.path.abspath(__file__)] + sys.argv[1:])

import ezdxf
from ezdxf.lldxf.loader import load_dxf_structure
from ezdxf.lldxf.tagger import ascii_tags_loader

if ezdxf.__version__ != "1.4.4":
    sys.exit(f"ezdxf 1.4.4 required (found {ezdxf.__version__}): pip install ezdxf==1.4.4")

HERE = os.path.dirname(os.path.abspath(__file__))
DWG_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "src", "renderer", "src", "engine", "__tests__",
                                        "fixtures", "corpus", "dwg"))
LIBREDWG_TAG = "0.13.3"
LIBREDWG_COMMIT = "97c7225596c17430b82fd0161e7eff6beb5b1034"
# Types whose loss in the writer round trip is recorded as an exclusion instead of rejecting the file.
KNOWN_LOSS_TYPES = {"DIMENSION", "HATCH", "MTEXT", "SPLINE", "VIEWPORT", "ELLIPSE", "POINT"}
VERSION_SUFFIX = {"r2000": "r2000", "r14": "r14", "r2004": "r2004"}


def find_bin():
    cands = []
    if os.environ.get("LIBREDWG_BIN"):
        cands.append(os.environ["LIBREDWG_BIN"])
    cands.append(os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"),
                              "mep-libredwg", "install", "bin"))
    for c in cands:
        if os.path.exists(os.path.join(c, "dxf2dwg")):
            return c
    which = shutil.which("dxf2dwg")
    if which:
        return os.path.dirname(which)
    sys.exit("dxf2dwg not found: run scripts/cad-corpus/build_libredwg.sh (or set LIBREDWG_BIN)")


def run(cmd):
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")


# --------------------------------------------------------------------------------------- input preparation
def normalise_handles(src, dst):
    """Give every layout entity a fresh handle, modelspace last and contiguous.

    LibreDWG 0.13.3 writes R13-R2000 entity lists as "first handle .. last handle" with nolinks=1. If block-definition
    contents (or paper-space entities) were created between two modelspace entities, their handles fall inside the
    modelspace range and readers (LibreDWG's own dwg2dxf and libredwg-web) attach them to the modelspace:
    a 3-LINE/1-LWPOLYLINE desk block and 5 ATTRIBs leaked into the 90-entity plan.

    Handles ARE referenced by other records: an ATTRIB / SEQEND / VERTEX names its parent INSERT / POLYLINE through its owner
    (group 330). reset_handle changes only the parent's own handle, so every child's owner is re-pointed at the new handle
    here. Without that, dxf2dwg wrote INSERTs with has_attribs = 1 but null first_attrib / last_attrib / seqend (dwgread JSON),
    and readers (libredwg-web) returned `attribs: []`; the writer check below now fails on such a file."""
    # dxf2dwg 0.13.3 leaves yscale/zscale uninitialised (observed: yscale = insertion y, zscale = 0) when a DXF INSERT carries
    # only a non-default xscale (a mirrored door). ezdxf omits default-valued group codes, so force 41/42/43/50 to be written.
    from ezdxf.entities import insert as ez_insert
    for attr in ("xscale", "yscale", "zscale", "rotation"):
        ez_insert.acdb_block_reference.attribs[attr].optional = False
    doc = ezdxf.readfile(src)
    db = doc.entitydb

    def fresh(e):
        db.reset_handle(e, db.next_handle())

    children = []

    def adopt(parent, child):
        """Defer a child record (ATTRIB, VERTEX, SEQEND): its handle is renumbered after the modelspace range (below) and its
        owner re-pointed at the parent's new handle."""
        children.append((parent, child))

    layouts = [doc.layouts.get(n) for n in doc.layouts.names() if n != "Model"]
    for layout in layouts + [doc.modelspace()]:
        for e in list(layout):
            fresh(e)
            if e.dxftype() == "INSERT":
                for a in e.attribs:
                    adopt(e, a)
                if e.attribs and e.seqend is not None:
                    adopt(e, e.seqend)
            if e.dxftype() == "POLYLINE":
                for v in e.vertices:
                    adopt(e, v)
                if e.seqend is not None:
                    adopt(e, e.seqend)
    # Children get handles above the modelspace range. Inside it, LibreDWG's first..last handle range would also list them as
    # loose model-space entities (every ATTRIB counted twice) next to the INSERT's own first_attrib / last_attrib links.
    for parent, child in children:
        fresh(child)
        child.dxf.owner = parent.dxf.handle
    doc.saveas(dst)


# --------------------------------------------------------------------------------------- summaries
def summary_from_ezdxf(path):
    doc = ezdxf.readfile(path)
    msp = doc.modelspace()
    by_type, by_layer = collections.Counter(), collections.Counter()
    attribs = 0
    texts = collections.Counter()
    insert_names = collections.Counter()
    for e in msp:
        by_type[e.dxftype()] += 1
        by_layer[f"{e.dxftype()}|{e.dxf.layer}"] += 1
        if e.dxftype() == "INSERT":
            attribs += len(e.attribs)
            insert_names[e.dxf.name] += 1
        elif e.dxftype() == "TEXT":
            texts[(e.dxftype(), e.dxf.layer, e.dxf.text, round(float(e.dxf.height), 6))] += 1
        elif e.dxftype() == "MTEXT":
            texts[(e.dxftype(), e.dxf.layer, e.text, round(float(e.dxf.char_height), 6))] += 1
    paper = collections.Counter()
    for n in doc.layouts.names():
        if n != "Model":
            for e in doc.layouts.get(n):
                paper[e.dxftype()] += 1
    layers = {}
    for l in doc.layers:
        c = l.dxf.color
        layers[l.dxf.name] = {"frozen": bool(l.dxf.flags & 1), "locked": bool(l.dxf.flags & 4), "off": c < 0, "color": abs(c)}
    blocks = sorted(b.name for b in doc.blocks if not b.name.startswith("*"))
    anon = sum(1 for b in doc.blocks if b.name.startswith("*D"))
    h = doc.header
    return {"byType": dict(by_type), "byTypeLayer": dict(by_layer), "attribs": attribs, "paperSpace": dict(paper),
            "layers": layers, "blocks": blocks, "dimBlocks": anon, "texts": texts, "insertNames": insert_names,
            "insunits": h.get("$INSUNITS", 0), "measurement": h.get("$MEASUREMENT", 0), "lunits": h.get("$LUNITS", 2)}



# Geometry-defining group codes per entity type with their DXF defaults (ezdxf omits defaults, LibreDWG writes them).
GEOMETRY = {
    "LINE": ((10, 0), (20, 0), (30, 0), (11, 0), (21, 0), (31, 0)),
    "CIRCLE": ((10, 0), (20, 0), (30, 0), (40, 0)),
    "ARC": ((10, 0), (20, 0), (30, 0), (40, 0), (50, 0), (51, 0)),
    "ELLIPSE": ((10, 0), (20, 0), (30, 0), (11, 0), (21, 0), (31, 0), (40, 1), (41, 0), (42, 6.283185307179586)),
    "POINT": ((10, 0), (20, 0), (30, 0)),
    "INSERT": ((10, 0), (20, 0), (30, 0), (41, 1), (42, 1), (43, 1), (50, 0)),
    "TEXT": ((10, 0), (20, 0), (50, 0)),  # z is compared separately (dxf2dwg drops it)
    "MTEXT": ((10, 0), (20, 0), (30, 0)),
}


def geometry_signature(t, ent):
    """Rounded geometry of one entity from its raw tags (same extraction for the ezdxf source and the dwg2dxf output)."""
    if t == "LWPOLYLINE":
        verts, closed = [], 0
        for x in ent:
            if x.code == 10:
                verts.append([float(x.value), 0.0, 0.0])
            elif x.code == 20 and verts:
                verts[-1][1] = float(x.value)
            elif x.code == 42 and verts:
                verts[-1][2] = float(x.value)
            elif x.code == 70:
                closed = int(x.value) & 1
        return (t, closed, tuple(tuple(round(c, 6) for c in v) for v in verts))
    if t == "SPLINE":  # point counts only: ctrl (10), fit (11), knots (40)
        return (t, tuple(sum(1 for x in ent if x.code == code) for code in (10, 11, 40)))
    spec = GEOMETRY.get(t)
    if spec is None:
        return None
    first = {}
    for x in ent:
        if x.code not in first:
            try:
                first[x.code] = float(x.value)
            except ValueError:
                pass
    return (t, tuple(round(first.get(code, default), 6) for code, default in spec))


def summary_from_dxf_tags(path):
    """Tag-level reader (no entity linking), because dwg2dxf omits SEQEND after INSERT attributes and ezdxf's strict
    loader rejects that. Only reads what the comparison needs."""
    with open(path, encoding="utf-8", errors="replace") as fh:
        structure = load_dxf_structure(ascii_tags_loader(fh, skip_comments=True))
    by_type, by_layer, paper = collections.Counter(), collections.Counter(), collections.Counter()
    attribs = 0
    texts = collections.Counter()
    geometry = collections.Counter()
    text_z = collections.Counter()
    insert_names = collections.Counter()
    for ent in structure.get("ENTITIES", [])[1:]:
        t = ent[0].value
        layer = next((x.value for x in ent if x.code == 8), "0")
        in_paper = any(x.code == 67 and int(x.value) == 1 for x in ent)
        if t in ("SEQEND", "ENDSEC"):
            continue
        if t == "ATTRIB":
            attribs += 1
            continue
        if in_paper:
            paper[t] += 1
        else:
            by_type[t] += 1
            by_layer[f"{t}|{layer}"] += 1
            if t == "INSERT":
                insert_names[next((x.value for x in ent if x.code == 2), "")] += 1
            sig = geometry_signature(t, ent)
            if sig:
                geometry[(layer,) + sig] += 1
            if t == "TEXT":
                text_z[(layer, round(float(next((x.value for x in ent if x.code == 30), 0)), 6))] += 1
            if t in ("TEXT", "MTEXT"):
                content = "".join(x.value for x in ent if x.code == 3) + next((x.value for x in ent if x.code == 1), "")
                texts[(t, layer, content, round(float(next((x.value for x in ent if x.code == 40), 0)), 6))] += 1
    layers = {}
    for ent in structure.get("TABLES", []):
        if ent[0].value == "LAYER" and len(ent) > 1:
            name = next(x.value for x in ent if x.code == 2)
            flags = int(next((x.value for x in ent if x.code == 70), 0))
            color = int(next((x.value for x in ent if x.code == 62), 7))
            layers[name] = {"frozen": bool(flags & 1), "locked": bool(flags & 4), "off": color < 0, "color": abs(color)}
    blocks, dims, current = [], 0, ""
    for ent in structure.get("BLOCKS", []):
        t = ent[0].value
        if t == "BLOCK":
            current = next((x.value for x in ent if x.code == 2), "")
            if current.startswith("*D"):
                dims += 1
            elif not current.startswith("*"):
                blocks.append(current)
        elif t in ("ENDBLK", "SECTION"):
            current = ""
        elif current.startswith("*Paper_Space") and t not in ("SEQEND",):
            # layouts other than the active one keep their entities in a *Paper_SpaceN block, in DXF as in DWG
            paper[t] += 1
    header = {}
    hdr = structure.get("HEADER", [[]])[0]
    key = None
    for tag in hdr:
        if tag.code == 9:
            key = tag.value
        elif key and key not in header:
            header[key] = tag.value
    return {"byType": dict(by_type), "byTypeLayer": dict(by_layer), "attribs": attribs, "paperSpace": dict(paper),
            "layers": layers, "blocks": sorted(blocks), "dimBlocks": dims, "texts": texts, "geometry": geometry, "textZ": text_z,
            "insertNames": insert_names,
            "insunits": header.get("$INSUNITS", 0), "measurement": header.get("$MEASUREMENT", 0),
            "lunits": header.get("$LUNITS", 2)}


def native_from_dwg(dwgread, dwg, tmp):
    """Facts read straight from the DWG via LibreDWG's own JSON dump (no dwg2dxf, no libredwg-web, no app code).

    layers: flag0 is the DWG flag word (1 frozen, 2 off, 4 frozen in new viewports, 8 locked); dwg2dxf cannot express "off"
    without a negative colour. inserts: for every model-space INSERT, the block name its block_header handle resolves to, and the
    attribute linkage (has_attribs must come with first_attrib / last_attrib resolving to ATTRIB objects, owned by the INSERT,
    and a seqend). Returns None when the dump fails."""
    out = os.path.join(tmp, os.path.basename(dwg) + ".json")
    r = run([dwgread, "-O", "json", "-o", out, dwg])
    if r.returncode != 0 or not os.path.exists(out):
        return None
    with open(out, encoding="utf-8", errors="replace") as fh:
        data = json.load(fh)
    objects = data.get("OBJECTS", [])
    by_ref = {}
    for o in objects:
        h = o.get("handle")
        if isinstance(h, list) and len(h) == 3:
            by_ref[h[2]] = o
    absref = lambda ref: ref[3] if isinstance(ref, list) and len(ref) == 4 else 0
    layers, block_names, attrib_problems = {}, collections.Counter(), []
    for o in objects:
        if o.get("object") == "LAYER":
            f = int(o.get("flag0", 0))
            c = o.get("color", 7)
            c = c.get("index", 7) if isinstance(c, dict) else c
            layers[o["name"]] = {"frozen": bool(f & 1), "locked": bool(f & 8), "off": bool(f & 2), "color": abs(int(c))}
        elif o.get("entity") == "INSERT":
            # model-space INSERTs have no owner handle in R2000 files written with first..last ranges; INSERTs nested in a
            # block definition are owned by their BLOCK_HEADER
            owner = by_ref.get(absref(o.get("ownerhandle")))
            if absref(o.get("ownerhandle")) == 0 or (owner is not None and str(owner.get("name", "")).lower().startswith("*model_space")):
                header = by_ref.get(absref(o.get("block_header")))
                block_names[header.get("name", "") if header and header.get("object") == "BLOCK_HEADER" else ""] += 1
            if o.get("has_attribs"):
                me = o["handle"][2]
                for field in ("first_attrib", "last_attrib"):
                    target = by_ref.get(absref(o.get(field)))
                    if target is None or target.get("entity") != "ATTRIB":
                        attrib_problems.append(f"INSERT {me:X}: {field} does not resolve to an ATTRIB ({o.get(field)})")
                    elif absref(target.get("ownerhandle")) != me:
                        attrib_problems.append(f"INSERT {me:X}: ATTRIB {target['handle'][2]:X} is owned by {absref(target.get('ownerhandle')):X}")
                seqend = by_ref.get(absref(o.get("seqend")))
                if seqend is None or seqend.get("entity") != "SEQEND":
                    attrib_problems.append(f"INSERT {me:X}: seqend does not resolve to a SEQEND ({o.get('seqend')})")
    return {"layers": layers, "insertBlockNames": block_names, "attribProblems": attrib_problems}


def compare(src, back, native, version):
    """Return (diffs, exclusions). A diff is a human-readable string; exclusions are per-type losses of KNOWN_LOSS_TYPES."""
    diffs, exclusions = [], {}
    for key in ("byType", "paperSpace"):
        for t in sorted(set(src[key]) | set(back[key])):
            a, b = src[key].get(t, 0), back[key].get(t, 0)
            if a != b:
                if t in KNOWN_LOSS_TYPES and b < a:
                    exclusions[f"{key}:{t}"] = {"source": a, "dwg": b}
                else:
                    diffs.append(f"{key} {t}: source {a}, dwg {b}")
    for k in sorted(set(src["byTypeLayer"]) | set(back["byTypeLayer"])):
        a, b = src["byTypeLayer"].get(k, 0), back["byTypeLayer"].get(k, 0)
        t = k.split("|")[0]
        if a != b and not (t in KNOWN_LOSS_TYPES and b < a):
            diffs.append(f"layer/type {k}: source {a}, dwg {b}")
    # text content and layer must survive; the text height is compared separately because of a known writer bug
    content = lambda c: collections.Counter((t, l, x) for (t, l, x, _h) in c.elements())
    if content(src["texts"]) != content(back["texts"]):
        diffs.append("TEXT/MTEXT content or layer differs between source and dwg")
    elif src["texts"] != back["texts"]:
        for kind in ("TEXT", "MTEXT"):
            a = sorted(h for (t, _l, _x, h) in src["texts"].elements() if t == kind)
            b = sorted(h for (t, _l, _x, h) in back["texts"].elements() if t == kind)
            if a != b:
                if kind == "MTEXT" and set(b) == {0.0}:
                    exclusions["MTEXT.textHeight"] = {
                        "source": sorted(set(a)), "dwg": [0.0], "count": len(a),
                        "cause": "LibreDWG 0.13.3 dxf2dwg maps DXF group 40 of MTEXT to rect_width (the annotation-context field of the same "
                                 "code), so MTEXT text_height is written as 0 and the height is stored in rectWidth"}
                else:
                    diffs.append(f"{kind} heights: source {sorted(set(a))}, dwg {sorted(set(b))}")
    splines = lambda c: collections.Counter({k: n for k, n in c.items() if k[1] == "SPLINE"})
    if splines(src["geometry"]) != splines(back["geometry"]):
        if all(sum(k[2]) == 0 for k in splines(back["geometry"]).elements()):
            exclusions["SPLINE.points"] = {
                "source": [list(k[2]) for k in splines(src["geometry"]).elements()], "dwg": [[0, 0, 0]],
                "cause": "LibreDWG 0.13.3 dxf2dwg writes a fit-point SPLINE with no fit points, control points or knots (empty entity)"}
        else:
            diffs.append("SPLINE point counts differ between source and dwg")
    rest = lambda c: collections.Counter({k: n for k, n in c.items() if k[1] != "SPLINE"})
    if rest(src["geometry"]) != rest(back["geometry"]):
        missing = list((rest(src["geometry"]) - rest(back["geometry"])).elements())
        extra = list((rest(back["geometry"]) - rest(src["geometry"])).elements())
        diffs.append(f"geometry differs: {len(missing)} source entities not in dwg (e.g. {missing[:2]}), "
                     f"{len(extra)} dwg entities not in source (e.g. {extra[:2]})")
    if src["textZ"] != back["textZ"]:
        if {z for (_l, z) in back["textZ"].elements()} == {0.0}:
            exclusions["TEXT.elevation"] = {
                "source": sorted({z for (_l, z) in src["textZ"].elements()}), "dwg": [0.0],
                "count": sum(n for (_l, z), n in src["textZ"].items() if z != 0),
                "cause": "LibreDWG 0.13.3 dxf2dwg does not store the Z of a DXF TEXT (R2000 keeps an `elevation` field it never fills)"}
        else:
            diffs.append(f"TEXT z: source {dict(src['textZ'])}, dwg {dict(back['textZ'])}")
    if src["attribs"] != back["attribs"]:
        diffs.append(f"INSERT attributes: source {src['attribs']}, dwg {back['attribs']}")
    for n in sorted(set(src["layers"]) | set(back["layers"])):
        a, b = src["layers"].get(n), back["layers"].get(n)
        if a != b:
            if a and b and {k for k in a if a[k] != b[k]} <= {"frozen", "locked"} and not (b["frozen"] and not a["frozen"]) \
                    and not (b["locked"] and not a["locked"]):
                # Unpatched dxf2dwg 0.13.3 never derives the DWG layer flag word (dwg.spec writes the unset `flag0`), so
                # frozen/locked/off are lost; the build script applies a patch for that. This stays as a safety net.
                exclusions[f"layer:{n}"] = {"source": {k: a[k] for k in ("frozen", "locked")},
                                            "dwg": {k: b[k] for k in ("frozen", "locked")},
                                            "cause": "LibreDWG 0.13.3 dxf2dwg drops the layer frozen/locked flags"}
            else:
                diffs.append(f"layer {n}: source {a}, dwg {b}")
    # INSERT attribute linkage, read natively (the dwg2dxf count above can be right while the DWG links are broken)
    diffs.extend(native["attribProblems"])
    # INSERT -> block linkage: the block each model-space INSERT resolves to natively must be the one the source names
    if native["insertBlockNames"] != src["insertNames"]:
        if version == "r14" and set(native["insertBlockNames"]) == {""}:
            exclusions["INSERT.blockName"] = {
                "source": sorted(src["insertNames"]), "dwg": [""],
                "cause": "LibreDWG 0.13.3 R14 defect: native dwgread (not only the libredwg-web WASM build) resolves every INSERT block_header "
                         "to a BLOCK_HEADER with an empty name in the R14 files dxf2dwg writes"}
        else:
            diffs.append(f"INSERT block names: source {dict(src['insertNames'])}, dwg {dict(native['insertBlockNames'])}")
    if src["blocks"] != back["blocks"]:
        diffs.append(f"blocks: source {src['blocks']}, dwg {back['blocks']}")
    if src["dimBlocks"] != back["dimBlocks"]:
        diffs.append(f"anonymous *D blocks: source {src['dimBlocks']}, dwg {back['dimBlocks']}")
    for k in ("insunits", "measurement", "lunits"):
        if int(src[k]) != int(back[k]):
            diffs.append(f"${k.upper()}: source {src[k]}, dwg {back[k]}")
    return diffs, exclusions


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        h.update(fh.read())
    return h.hexdigest()


def main():
    versions = ["r2000", "r14", "r2004"]
    for a in sys.argv[1:]:
        if a.startswith("--versions="):
            versions = a.split("=", 1)[1].split(",")
    bin_dir = find_bin()
    dxf2dwg, dwg2dxf = os.path.join(bin_dir, "dxf2dwg"), os.path.join(bin_dir, "dwg2dxf")
    dwgread = os.path.join(bin_dir, "dwgread")
    patch_files = sorted(f for f in os.listdir(os.path.join(HERE, "patches")) if f.startswith("libredwg-0.13.3-") and f.endswith(".patch"))
    patch_sha = hashlib.sha256(b"".join(open(os.path.join(HERE, "patches", f), "rb").read() for f in patch_files)).hexdigest()
    stamp = os.path.join(os.path.dirname(bin_dir), ".patch-sha256")
    if not os.path.exists(stamp) or open(stamp).read().strip() != patch_sha:
        sys.exit("LibreDWG build lacks the scripts/cad-corpus/patches: run scripts/cad-corpus/build_libredwg.sh")
    ver_out = run([dxf2dwg, "--version"]).stdout.strip().splitlines()[0]
    if LIBREDWG_TAG not in ver_out:
        sys.exit(f"expected LibreDWG {LIBREDWG_TAG}, found '{ver_out}' (rebuild with build_libredwg.sh)")
    twins = sorted(f for f in os.listdir(DWG_DIR) if f.endswith("-r2000.dxf"))
    if not twins:
        sys.exit("no R2000 twins: run generate_corpus.py --r2000-twins first")
    files, rejected = {}, []
    with tempfile.TemporaryDirectory(prefix="mep-dwg-") as tmp:
        for twin in twins:
            stem = twin[:-len("-r2000.dxf")]
            src_path = os.path.join(DWG_DIR, twin)
            src = summary_from_ezdxf(src_path)
            src_tags = summary_from_dxf_tags(src_path)  # same extraction as the dwg2dxf side
            for key in ("byType", "byTypeLayer", "attribs", "blocks", "texts"):
                assert src[key] == src_tags[key] or key == "attribs", f"summary mismatch on the source ({key})"
            src["geometry"], src["textZ"] = src_tags["geometry"], src_tags["textZ"]
            prepared = os.path.join(tmp, stem + ".in.dxf")
            normalise_handles(src_path, prepared)
            for ver in versions:
                out_name = f"{stem}-{VERSION_SUFFIX[ver]}.dwg"
                dwg = os.path.join(tmp, out_name)
                w = run([dxf2dwg, "-y", "--as", ver, "-o", dwg, prepared])
                if w.returncode != 0 or not os.path.exists(dwg):
                    rejected.append({"twin": twin, "version": ver, "reason": f"dxf2dwg exit {w.returncode}",
                                     "log": [l.replace(tmp, "<tmp>") for l in w.stdout.splitlines() if "ERROR" in l][:5]})
                    continue
                back_path = os.path.join(tmp, out_name + ".back.dxf")
                r = run([dwg2dxf, "-y", "-o", back_path, dwg])
                if r.returncode != 0 or not os.path.exists(back_path):
                    rejected.append({"twin": twin, "version": ver, "reason": f"dwg2dxf of the written file failed (exit {r.returncode})",
                                     "log": [l.replace(tmp, "<tmp>") for l in r.stdout.splitlines() if "ERROR" in l][:5]})
                    continue
                back = summary_from_dxf_tags(back_path)
                native = native_from_dwg(dwgread, dwg, tmp)
                if native is None:
                    rejected.append({"twin": twin, "version": ver, "reason": "dwgread -O json of the written file failed"})
                    continue
                back["layers"] = native["layers"]
                diffs, exclusions = compare(src, back, native, ver)
                if diffs:
                    rejected.append({"twin": twin, "version": ver, "reason": "writer check differs from the ezdxf source",
                                     "diffs": diffs[:20], "diffCount": len(diffs)})
                    continue
                shutil.copyfile(dwg, os.path.join(DWG_DIR, out_name))
                files[out_name] = {
                    "twin": twin, "dwgVersion": ver, "sha256": sha256(dwg), "bytes": os.path.getsize(dwg),
                    "ezdxfCounts": {"modelSpaceByType": src["byType"], "insertAttributes": src["attribs"],
                                    "paperSpaceByType": src["paperSpace"], "dimensionBlocks": src["dimBlocks"]},
                    "layers": src["layers"], "blocks": src["blocks"],
                    "texts": sorted([{"type": t, "layer": l, "text": x, "height": h, "n": n} for (t, l, x, h), n in src["texts"].items()],
                                    key=lambda d: (d["type"], d["layer"], d["text"], d["height"])),
                    "insunits": src["insunits"], "measurement": src["measurement"],
                    "writerCheck": {"status": "pass-with-exclusions" if exclusions else "pass",
                                    "compared": ["entity counts by type", "entity counts by type and layer",
                                                 "paper-space entities by type", "INSERT attribute count", "INSERT attribute linkage (first_attrib / last_attrib / seqend resolve to ATTRIB / SEQEND owned by the INSERT, dwgread JSON)",
                                                 "model-space INSERT -> block name (block_header resolves to the source block, dwgread JSON)", "layer table (frozen/off/locked/colour, from dwgread JSON)",
                                                 "block names", "anonymous dimension blocks", "$INSUNITS/$MEASUREMENT/$LUNITS"],
                                    "exclusions": exclusions},
                }
    for stale in os.listdir(DWG_DIR):
        if stale.endswith(".dwg") and stale not in files:
            os.remove(os.path.join(DWG_DIR, stale))
    manifest = {
        "about": "Binary DWG fixtures written by LibreDWG dxf2dwg from the R2000 ezdxf twins in this directory. Counts, layers and "
                 "blocks come from the ezdxf SOURCE document, never from our parsers. A file is committed only if LibreDWG's own "
                 "dwg2dxf round trip matches the source (writerCheck). Rejected (twin, version) pairs are listed with the reason.",
        "libredwg": {"tag": LIBREDWG_TAG, "commit": LIBREDWG_COMMIT, "version": ver_out,
                     "patches": {"files": [f"scripts/cad-corpus/patches/{f}" for f in patch_files], "sha256OfConcatenation": patch_sha,
                            "purpose": {"layer-flags": "dxf2dwg writes the layer frozen/off/locked flag word (0.13.3 writes 0 and loses them)",
                                        "mtext-height": "dxf2dwg stores MTEXT group 40 as text_height (0.13.3 stores rect_width, height 0)",
                                        "text-dataflags": "dxf2dwg sets the TEXT / ATTRIB / ATTDEF dataflags with the right sense (0.13.3 inverted them and dropped elevation, rotation, oblique angle, width factor, generation and alignments)"}}},
        "generator": {"ezdxf": ezdxf.__version__},
        "handleNormalisation": "entity handles are renumbered before dxf2dwg (modelspace last; ATTRIB / VERTEX / SEQEND children after it, with their owner re-pointed at the parent's new handle) to avoid LibreDWG 0.13.3 first/last handle-range entity leaks and unlinked INSERT attributes",
        "files": files,
        "rejected": rejected,
    }
    with open(os.path.join(DWG_DIR, "dwg-manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1, ensure_ascii=False, sort_keys=True)
        fh.write("\n")
    for n in sorted(files):
        print("OK  ", n, files[n]["bytes"], "bytes", files[n]["writerCheck"]["status"], list(files[n]["writerCheck"]["exclusions"]))
    for r in rejected:
        print("REJECTED", r["twin"], r["version"], r["reason"], r.get("diffs", [])[:3])
    if not any(n.endswith("-r2000.dwg") for n in files):
        sys.exit("no R2000 DWG passed the writer check")
    missing = [t for t in twins if f"{t[:-len('-r2000.dxf')]}-r2000.dwg" not in files]
    if missing:
        sys.exit(f"R2000 writer check failed for {missing}: LibreDWG writer defect, see 'rejected' in dwg-manifest.json")


if __name__ == "__main__":
    main()
