#!/usr/bin/env python3
"""Generates SolidCraft batch recipes for the game's cars (and the wheel).

CAD frame: X forward, Y left/right, Z up, millimetres. Run:
  python3 scripts/models/gen_cars.py <outdir>
Each <name>.json is fed to the SolidCraft MCP `batch` (path=...), then exported as GLB.
Bodies are named Body (paint), Glass, Trim, Head, Tail so the game can assign materials.
"""
import json, sys, os, math

PLANE = {"origin": [0, 0, 0], "x_dir": [1, 0, 0], "y_dir": [0, 0, 1]}  # side view, normal -Y


def mm(v):
    return round(v * 1000, 1)


def poly(name, pts, width, body, fillet=None, offset=0.0):
    """Closed side-profile polygon (x,z metres) extruded symmetrically by `width` metres."""
    c = [{"command": "sketch.create", "params": {"plane": PLANE, "name": name}}]
    P = [[mm(x), mm(z)] for x, z in pts]
    c.append({"command": "sketch.line", "params": {"points": P, "closed": True}})
    c.append({"command": "sketch.finish", "params": {}})
    c.append({"command": "solid.extrude", "params": {
        "distance": mm(width), "direction": "symmetric", "name": name + "_x",
        "body_name": body, "operation": "new"}})
    return c


def fillet_edges(body, pts, width, radius):
    picks = []
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        for s in (1, -1):
            picks.append([mm(mx), mm(s * width / 2), mm(mz)])
    return {"command": "solid.fillet", "params": {"edges": picks, "radius": mm(radius), "name": body + "_fillet", "body": body}}


def box(name, x0, x1, y0, y1, z0, z1):
    return {"command": "solid.box", "params": {
        "corner": [mm(x0), mm(y0), mm(z0)], "length": mm(x1 - x0), "width": mm(y1 - y0), "height": mm(z1 - z0),
        "operation": "new", "body_name": name, "name": name + "_box"}}


def paint(body, color, metallic, rough):
    return {"command": "appearance.assign", "params": {"bodies": [body], "color": color,
            "pbr": {"metallic": metallic, "roughness": rough, "dielectric_ior": 1.5}}}


def car(spec):
    L, W = spec["L"], spec["W"]
    cmds = [{"command": "edit.new", "params": {}}] if False else []
    lower = spec["lower"]
    cmds += poly("Lower", lower, W, "Body")
    if spec.get('arch_first', False):
        # wheel arches (cut before filleting; planar target)
        for sx in (spec["wb"] / 2, -spec["wb"] / 2):
            cmds.append({"command": "solid.cylinder", "params": {
                "radius": mm(spec["R"] + spec.get("clear", 0.07)), "height": mm(W + 0.4), "axis": "Y",
                "base": [mm(sx), mm(-(W + 0.4) / 2), mm(spec["R"])], "operation": "cut",
                "targets": ["Body"], "name": f"Arch{int(sx*1000)}"}})
        cmds.append(fillet_edges("Body", lower, W, spec.get("fr", 0.08)))
    else:
        cmds.append(fillet_edges("Body", lower, W, spec.get("fr", 0.08)))
        # wheel arches (cut before filleting; planar target)
        for sx in (spec["wb"] / 2, -spec["wb"] / 2):
            cmds.append({"command": "solid.cylinder", "params": {
                "radius": mm(spec["R"] + spec.get("clear", 0.07)), "height": mm(W + 0.4), "axis": "Y",
                "base": [mm(sx), mm(-(W + 0.4) / 2), mm(spec["R"])], "operation": "cut",
                "targets": ["Body"], "name": f"Arch{int(sx*1000)}"}})
    cmds.append(paint("Body", "#c0152a", 0.55, 0.28))
    # greenhouse (glass) + roof slab + B pillar (paint)
    cmds += poly("Cabin", spec["cabin"], spec["cw"], "Glass")
    cmds.append(paint("Glass", "#0b1118", 0.9, 0.06))
    rx0, rx1, rz = spec["roof"]
    cmds.append(box("Roof", rx0, rx1, -spec["cw"] / 2 - 0.01, spec["cw"] / 2 + 0.01, rz, rz + 0.05))
    cmds.append(paint("Roof", "#c0152a", 0.55, 0.28))
    for i, t in enumerate(spec.get("bodyboxes", [])):  # extra painted panels (pickup bed walls, wings)
        cmds.append(box(f"BodyX{i}", *t))
        cmds.append(paint(f"BodyX{i}", "#c0152a", 0.55, 0.28))
    for tgt in spec.get("late_arch_targets", []):  # arches cut into extra panels (pickup bed floor)
        for sx in (spec["wb"] / 2, -spec["wb"] / 2):
            cmds.append({"command": "solid.cylinder", "params": {
                "radius": mm(spec["R"] + 0.015), "height": mm(W + 0.4), "axis": "Y",
                "base": [mm(sx), mm(-(W + 0.4) / 2), mm(spec["R"])], "operation": "cut",
                "targets": [tgt], "name": f"Arch{tgt}{int(sx*1000)}"}})
    # trim: bumpers, grille, skirts, mirrors
    trim = spec["trim"]
    for i, t in enumerate(trim):
        cmds.append(box(f"Trim{i}", *t))
    for i, t in enumerate(spec["head"]):
        cmds.append(box(f"Head{i}", *t))
    for i, t in enumerate(spec["tail"]):
        cmds.append(box(f"Tail{i}", *t))
    cmds += [paint(f"Trim{i}", "#15171b", 0.2, 0.6) for i in range(len(trim))]
    cmds += [paint(f"Head{i}", "#fff6dc", 0.1, 0.1) for i in range(len(spec["head"]))]
    cmds += [paint(f"Tail{i}", "#e01824", 0.1, 0.2) for i in range(len(spec["tail"]))]
    return cmds


SEDAN = dict(
    L=4.5, W=1.86, wb=2.8, R=0.35, cw=1.66, fr=0.08,
    lower=[(2.25, .36), (2.28, .55), (2.22, .68), (2.05, .80), (1.2, .92), (.75, .97), (-1.45, .97), (-2.05, .96),
           (-2.24, .84), (-2.27, .60), (-2.25, .38), (-1.6, .30), (1.6, .30)],
    cabin=[(.78, .97), (.12, 1.42), (-1.0, 1.42), (-1.58, .97)],
    roof=(-1.05, .17, 1.40),
    trim=[(2.12, 2.30, -.85, .85, .36, .50), (2.20, 2.31, -.5, .5, .58, .74), (-2.31, -2.12, -.85, .85, .36, .50),
          (-1.2, 1.2, -.93, .93, .28, .38), (.7, .86, .93, 1.07, .98, 1.08), (.7, .86, -1.07, -.93, .98, 1.08)],
    head=[(2.16, 2.30, .50, .86, .64, .76), (2.16, 2.30, -.86, -.50, .64, .76)],
    tail=[(-2.30, -2.14, .52, .90, .70, .82), (-2.30, -2.14, -.90, -.52, .70, .82)],
)

COUPE = dict(
    L=4.35, W=1.82, wb=2.6, R=0.34, cw=1.62, fr=0.08,
    lower=[(2.175, .34), (2.2, .52), (2.14, .64), (1.95, .74), (1.1, .86), (.6, .90), (-1.5, .92), (-1.95, .93),
           (-2.15, .82), (-2.19, .60), (-2.175, .36), (-1.5, .28), (1.5, .28)],
    cabin=[(.55, .90), (-.2, 1.30), (-1.0, 1.30), (-1.6, .92)],
    roof=(-1.05, -.15, 1.28),
    trim=[(2.03, 2.2, -.82, .82, .32, .44), (2.12, 2.21, -.45, .45, .50, .64), (-2.2, -2.05, -.82, .82, .34, .46),
          (-1.1, 1.1, -.91, .91, .26, .36), (.6, .76, .82, .96, .92, 1.02), (.6, .76, -.96, -.82, .92, 1.02),
          (-2.26, -2.08, .45, .65, .36, .46), (-2.26, -2.08, -.65, -.45, .36, .46)],
    head=[(2.08, 2.21, .45, .8, .58, .68), (2.08, 2.21, -.8, -.45, .58, .68)],
    tail=[(-2.2, -2.05, .5, .86, .66, .78), (-2.2, -2.05, -.86, -.5, .66, .78)],
)
SUV = dict(
    L=4.9, W=2.02, wb=3.0, R=0.42, cw=1.86, fr=0.1,
    lower=[(2.45, .48), (2.48, .80), (2.4, .98), (2.2, 1.08), (1.4, 1.14), (.95, 1.18), (-2.2, 1.18), (-2.42, 1.14),
           (-2.46, .90), (-2.45, .50), (-1.8, .40), (1.8, .40)],
    cabin=[(.9, 1.18), (.55, 1.72), (-2.1, 1.72), (-2.36, 1.18)],
    roof=(-2.15, .6, 1.70),
    trim=[(2.3, 2.47, -.95, .95, .46, .62), (2.38, 2.49, -.6, .6, .74, .96), (-2.47, -2.3, -.95, .95, .46, .62),
          (-1.3, 1.3, -1.02, 1.02, .34, .46), (.9, 1.0, .95, 1.12, 1.2, 1.3), (.9, 1.0, -1.12, -.95, 1.2, 1.3),
          (-1.9, .3, .78, .86, 1.74, 1.79), (-1.9, .3, -.86, -.78, 1.74, 1.79)],
    head=[(2.34, 2.48, .6, 1.0, .86, 1.0), (2.34, 2.48, -1.0, -.6, .86, 1.0)],
    tail=[(-2.48, -2.34, .6, 1.0, .9, 1.04), (-2.48, -2.34, -1.0, -.6, .9, 1.04)],
)
VAN = dict(
    L=5.3, W=2.06, wb=3.2, R=0.40, cw=2.09, fr=0.1,
    lower=[(2.65, .46), (2.68, .85), (2.55, 1.1), (2.0, 1.2), (1.5, 1.85), (-2.55, 1.95), (-2.65, 1.9), (-2.68, .6),
           (-2.62, .46), (-2.0, .40), (2.0, .40)],
    cabin=[(2.01, 1.2), (1.51, 1.85), (.2, 1.85), (.2, 1.2)],
    roof=(-2.5, 1.4, 1.93),
    trim=[(2.5, 2.69, -1.0, 1.0, .46, .62), (2.58, 2.69, -.55, .55, .7, .9), (-2.69, -2.5, -1.0, 1.0, .46, .62),
          (-1.5, 1.5, -1.05, 1.05, .36, .46), (1.55, 1.7, 1.02, 1.2, 1.3, 1.4), (1.55, 1.7, -1.2, -1.02, 1.3, 1.4)],
    head=[(2.52, 2.69, .6, 1.0, .72, .86), (2.52, 2.69, -1.0, -.6, .72, .86)],
    tail=[(-2.69, -2.55, .7, 1.0, 1.0, 1.4), (-2.69, -2.55, -1.0, -.7, 1.0, 1.4)],
)
PICKUP = dict(
    L=5.2, W=2.0, wb=3.1, R=0.44, cw=1.8, fr=0.09,
    lower=[(2.6, .5), (2.63, .85), (2.55, 1.05), (2.35, 1.15), (1.5, 1.2), (1.1, 1.22), (-.3, 1.22), (-.3, .45),
           (1.8, .45)],
    cabin=[(1.15, 1.22), (.65, 1.82), (-.15, 1.82), (-.3, 1.22)],
    roof=(-.2, .7, 1.80),
    bodyboxes=[(-2.6, -.3, -1.0, 1.0, .62, .95), (-2.58, -.3, .88, 1.0, .95, 1.3), (-2.58, -.3, -1.0, -.88, .95, 1.3),
               (-2.6, -2.48, -1.0, 1.0, .95, 1.3), (-.46, -.3, -.9, .9, .95, 1.4)],
    late_arch_targets=["BodyX0"],
    trim=[(2.45, 2.64, -.95, .95, .5, .66), (2.52, 2.65, -.6, .6, .78, 1.0), (-2.64, -2.5, -.95, .95, .5, .62),
          (-.2, 1.4, -1.02, 1.02, .36, .48), (.9, 1.0, .9, 1.1, 1.24, 1.34), (.9, 1.0, -1.1, -.9, 1.24, 1.34)],
    head=[(2.48, 2.64, .6, .96, .86, 1.0), (2.48, 2.64, -.96, -.6, .86, 1.0)],
    tail=[(-2.64, -2.55, .62, .95, 1.1, 1.24), (-2.64, -2.55, -.95, -.62, 1.1, 1.24)],
)
SPORTS = dict(
    L=4.3, W=1.94, wb=2.55, R=0.34, cw=1.64, fr=0.07, clear=0.04,
    lower=[(2.15, .28), (2.2, .42), (2.1, .58), (1.8, .70), (.9, .78), (.45, .82), (-1.3, .86), (-1.9, .90),
           (-2.12, .78), (-2.16, .5), (-2.15, .3), (-1.6, .24), (1.6, .24)],
    cabin=[(.5, .80), (-.1, 1.18), (-.8, 1.18), (-1.4, .86)],
    roof=(-.85, -.05, 1.16),
    bodyboxes=[(-2.14, -1.82, -.85, .85, .98, 1.03)],
    trim=[(1.98, 2.2, -.9, .9, .26, .36), (2.1, 2.21, -.55, .55, .44, .56), (-2.16, -1.95, -.9, .9, .26, .38),
          (-1.0, 1.0, -.97, .97, .22, .32), (.5, .66, .88, 1.0, .8, .88), (.5, .66, -1.0, -.88, .8, .88),
          (-2.0, -1.92, .7, .76, .86, .98), (-2.0, -1.92, -.76, -.7, .86, .98), (-2.22, -2.05, .4, .6, .3, .4),
          (-2.22, -2.05, -.6, -.4, .3, .4)],
    head=[(2.08, 2.21, .5, .88, .45, .53), (2.08, 2.21, -.88, -.5, .45, .53)],
    tail=[(-2.18, -2.08, .55, .92, .62, .72), (-2.18, -2.08, -.92, -.55, .62, .72)],
)

if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for name, spec in {"sedan": SEDAN, "coupe": COUPE, "suv": SUV, "van": VAN, "pickup": PICKUP, "sports": SPORTS}.items():
        json.dump({"commands": car(spec)}, open(os.path.join(out, name + ".json"), "w"))
