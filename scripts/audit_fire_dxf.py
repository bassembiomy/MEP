#!/usr/bin/env python3
"""Independent audit of the generated fire pump-room DXF using ezdxf.

Usage: python3 scripts/audit_fire_dxf.py <file.dxf> [png_out_dir]
- Re-reads the DXF with ezdxf (a third-party parser) and runs its auditor.
- Prints entity / layer census and fails on any audit error.
- Optionally renders each sheet frame to PNG (matplotlib) for visual review.
"""
import sys
import ezdxf
from ezdxf import recover

path = sys.argv[1]
doc, auditor = recover.readfile(path)
if auditor.has_errors:
    for e in auditor.errors[:20]:
        print("ERROR", e)
    sys.exit(f"ezdxf audit: {len(auditor.errors)} errors")
doc.audit()
msp = doc.modelspace()
print("DXF version:", doc.dxfversion, "| entities:", len(msp), "| layers:", len(doc.layers))
census = {}
for e in msp:
    census[e.dxftype()] = census.get(e.dxftype(), 0) + 1
print("census:", census)
undefined = {e.dxf.layer for e in msp} - {l.dxf.name for l in doc.layers}
assert not undefined, f"entities on undefined layers: {undefined}"

if len(sys.argv) > 2:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from ezdxf.addons.drawing import RenderContext, Frontend
    from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
    from ezdxf.addons.drawing.config import Configuration, BackgroundPolicy, ColorPolicy
    out = sys.argv[2]
    # sheet frames = outer FP-TBLK closed polylines with the largest areas
    frames = []
    for e in msp.query('POLYLINE[layer=="FP-TBLK"]'):
        pts = [v.dxf.location for v in e.vertices]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        frames.append((min(xs), min(ys), max(xs), max(ys)))
    frames.sort(key=lambda f: -(f[2] - f[0]) * (f[3] - f[1]))
    big = frames[0]
    area = (big[2] - big[0]) * (big[3] - big[1])
    sheets = sorted({f for f in frames if (f[2]-f[0])*(f[3]-f[1]) > 0.9 * area * 0.25 and (f[2]-f[0]) > (big[2]-big[0]) * 0.5}, key=lambda f: f[0])
    # keep outermost frame per x-position
    outer = []
    for f in sheets:
        if not any(o[0] <= f[0] and o[2] >= f[2] and o != f for o in sheets):
            outer.append(f)
    cfg = Configuration(background_policy=BackgroundPolicy.WHITE, color_policy=ColorPolicy.COLOR)
    fig = plt.figure(figsize=(33.1, 23.4), dpi=60)
    ax = fig.add_axes([0, 0, 1, 1])
    Frontend(RenderContext(doc), MatplotlibBackend(ax), config=cfg).draw_layout(msp)
    for i, f in enumerate(outer):
        ax.set_xlim(f[0], f[2]); ax.set_ylim(f[1], f[3]); ax.set_aspect("equal")
        fig.savefig(f"{out}/sheet_{i+1}.png", dpi=60)
        print("rendered", f"{out}/sheet_{i+1}.png")
print("AUDIT OK")
