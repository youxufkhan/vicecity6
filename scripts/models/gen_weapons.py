#!/usr/bin/env python3
"""SolidCraft batch recipes for the three guns (grip at the origin, barrel along +X, Z up, mm).
Every body is named Gun<Part> and carries its own colour and metal/rough so the game can build one
material per part. Usage: python3 scripts/models/gen_weapons.py <outdir>
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from gen_cars import PLANE

def poly(name, pts, width, fr=None):
    c = [{"command": "sketch.create", "params": {"plane": PLANE, "name": name}},
         {"command": "sketch.line", "params": {"points": [list(p) for p in pts], "closed": True}},
         {"command": "sketch.finish", "params": {}},
         {"command": "solid.extrude", "params": {"distance": width, "direction": "symmetric", "name": name + "_x",
                                                 "body_name": name, "operation": "new"}}]
    if fr:
        picks = []
        n = len(pts)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            for s in (1, -1):
                picks.append([(a[0] + b[0]) / 2, s * width / 2, (a[1] + b[1]) / 2])
        c.append({"command": "solid.fillet", "params": {"edges": picks, "radius": fr, "body": name, "name": name + "_f"}})
    return c

def cyl(name, x0, length, r, z=0, y=0):
    return [{"command": "solid.cylinder", "params": {"radius": r, "height": length, "axis": "X", "base": [x0, y, z],
                                                    "operation": "new", "body_name": name, "name": name + "_c"}}]

def box(name, x0, x1, y0, y1, z0, z1):
    return [{"command": "solid.box", "params": {"corner": [x0, y0, z0], "length": x1 - x0, "width": y1 - y0,
                                                "height": z1 - z0, "operation": "new", "body_name": name, "name": name + "_b"}}]

def look(names, color, m, r):
    return [{"command": "appearance.assign", "params": {"bodies": names, "color": color,
             "pbr": {"metallic": m, "roughness": r, "dielectric_ior": 1.5}}}]

STEEL, BLUED, WOOD, BLACK, GOLD = ("#e2e8f0", .92, .18), ("#1b222c", .85, .25), ("#5c2810", .05, .7), ("#181b22", .3, .6), ("#d4af37", .8, .3)

def pistol():
    c = []
    c += poly("GunSlide", [(-95, 5), (-95, 92), (-70, 104), (245, 104), (262, 92), (262, 5)], 40, 7) + look(["GunSlide"], *STEEL)
    c += poly("GunGrip", [(-80, 5), (-112, -170), (-30, -178), (14, -22), (110, -22), (110, 5)], 34, 6) + look(["GunGrip"], *WOOD)
    c += box("GunTrigger", 40, 52, -5, 5, -42, -10) + look(["GunTrigger"], *GOLD)
    c += box("GunGuard", 10, 120, -4, 4, -38, -22) + look(["GunGuard"], *STEEL)
    c += cyl("GunMuzzle", 250, 22, 14, 62) + look(["GunMuzzle"], *BLUED)
    c += box("GunSight", 225, 245, -4, 4, 104, 122) + box("GunSightR", -80, -50, -12, 12, 104, 118) + look(["GunSight", "GunSightR"], "#0e1218", .5, .4)
    return c

def smg():
    c = []
    c += poly("GunReceiver", [(-140, 0), (-140, 118), (-110, 128), (270, 128), (280, 118), (280, 0)], 52, 8) + look(["GunReceiver"], "#22272f", .65, .4)
    c += cyl("GunShroud", 280, 110, 33, 70) + look(["GunShroud"], "#dcdde1", .9, .2)
    c += cyl("GunBarrel", 390, 70, 16, 70) + look(["GunBarrel"], BLUED[0], .8, .25)
    c += poly("GunMag", [(60, 0), (112, 0), (126, -95), (160, -180), (112, -188), (84, -100)], 30, 5) + look(["GunMag"], "#2b303a", .5, .5)
    c += poly("GunGrip", [(-70, 0), (-104, -165), (-28, -172), (8, -4)], 34, 6) + look(["GunGrip"], *BLACK)
    c += poly("GunStock", [(-140, 25), (-340, 18), (-350, 100), (-140, 108)], 26, 5) + look(["GunStock"], "#333a44", .6, .45)
    c += box("GunSight", 230, 250, -4, 4, 128, 146) + look(["GunSight"], "#0e1218", .5, .4)
    return c

def shotgun():
    c = []
    c += cyl("GunBarrel", -20, 760, 32, 58) + look(["GunBarrel"], *BLUED)
    c += cyl("GunMagTube", 20, 560, 28, 6) + look(["GunMagTube"], "#252b34", .8, .3)
    c += poly("GunReceiver", [(-190, -20), (-190, 112), (-150, 124), (140, 124), (160, 112), (160, -20)], 56, 9) + look(["GunReceiver"], *BLUED)
    c += poly("GunPump", [(210, -22), (210, 34), (400, 34), (410, 10), (400, -22)], 70, 10) + look(["GunPump"], "#5c341b", .05, .65)
    c += poly("GunStock", [(-190, 100), (-560, 60), (-600, -90), (-520, -110), (-190, -20)], 46, 10) + look(["GunStock"], "#5c341b", .05, .65)
    c += box("GunBead", 730, 742, -4, 4, 90, 106) + look(["GunBead"], "#ffffff", .1, .6)
    return c

if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for n, f in {"pistol": pistol, "smg": smg, "shotgun": shotgun}.items():
        json.dump({"commands": f()}, open(os.path.join(out, n + ".json"), "w"))
