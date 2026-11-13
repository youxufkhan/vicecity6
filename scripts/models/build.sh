#!/usr/bin/env bash
# Rebuild every runtime model from the SolidCraft GLB exports in scripts/models/src/.
set -euo pipefail
cd "$(dirname "$0")/../.."
for car in sedan coupe suv van pickup sports; do
  node scripts/models/optimize.mjs scripts/models/src/$car.glb src/assets/models/$car.json Body=3200 | tail -1
done
node scripts/models/optimize.mjs scripts/models/src/wheel.glb src/assets/models/wheel.json Tyre=240,Rim=170,Disc=50,Hub=40 | tail -1
node scripts/models/optimize.mjs scripts/models/src/soft.glb src/assets/models/soft.json SoftBox=260,SoftRound=260,SoftLimb=220 | tail -1
for gun in pistol smg shotgun; do
  node scripts/models/optimize.mjs scripts/models/src/$gun.glb src/assets/models/$gun.json GunSlide=500,GunGrip=300,GunReceiver=450,GunMag=250,GunStock=300,GunPump=300,GunShroud=200,GunBarrel=200,GunMagTube=200 | tail -1
done
