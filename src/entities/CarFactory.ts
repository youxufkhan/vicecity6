import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyColor } from '../world/GeoUtil';

export type Livery = 'civil' | 'police' | 'taxi' | 'sport';

export interface CarSpec {
  id: string;
  label: string;
  length: number;
  width: number;
  bodyBottom: number;
  bodyHeight: number;
  cabinHeight: number;
  cabinLength: number;
  cabinWidth: number;
  cabinZ: number;
  wheelBase: number;
  track: number;
  wheelRadius: number;
  mass: number;
  power: number;
  topSpeed: number;
  grip: number;
  steering: number;
}

export const CAR_SPECS: Record<string, CarSpec> = {
  sedan: {
    id: 'sedan',
    label: 'SEDAN',
    length: 4.5,
    width: 1.86,
    bodyBottom: 0.34,
    bodyHeight: 0.72,
    cabinHeight: 0.62,
    cabinLength: 2.1,
    cabinWidth: 1.66,
    cabinZ: -0.1,
    wheelBase: 2.8,
    track: 1.56,
    wheelRadius: 0.35,
    mass: 1300,
    power: 12,
    topSpeed: 43,
    grip: 11,
    steering: 1.75,
  },
  coupe: {
    id: 'coupe',
    label: 'COUPE',
    length: 4.35,
    width: 1.82,
    bodyBottom: 0.3,
    bodyHeight: 0.62,
    cabinHeight: 0.56,
    cabinLength: 1.9,
    cabinWidth: 1.62,
    cabinZ: -0.24,
    wheelBase: 2.6,
    track: 1.54,
    wheelRadius: 0.34,
    mass: 1180,
    power: 15,
    topSpeed: 50,
    grip: 11.5,
    steering: 1.95,
  },
  suv: {
    id: 'suv',
    label: 'SUV',
    length: 4.9,
    width: 2.02,
    bodyBottom: 0.46,
    bodyHeight: 0.86,
    cabinHeight: 0.74,
    cabinLength: 2.7,
    cabinWidth: 1.86,
    cabinZ: -0.05,
    wheelBase: 3.0,
    track: 1.7,
    wheelRadius: 0.42,
    mass: 1750,
    power: 10.5,
    topSpeed: 38,
    grip: 9.5,
    steering: 1.5,
  },
  van: {
    id: 'van',
    label: 'VAN',
    length: 5.3,
    width: 2.06,
    bodyBottom: 0.44,
    bodyHeight: 1.2,
    cabinHeight: 0.6,
    cabinLength: 1.7,
    cabinWidth: 1.9,
    cabinZ: 1.35,
    wheelBase: 3.2,
    track: 1.72,
    wheelRadius: 0.4,
    mass: 1900,
    power: 8.5,
    topSpeed: 34,
    grip: 8.5,
    steering: 1.35,
  },
  pickup: {
    id: 'pickup',
    label: 'PICKUP',
    length: 5.2,
    width: 2.0,
    bodyBottom: 0.5,
    bodyHeight: 0.82,
    cabinHeight: 0.78,
    cabinLength: 1.8,
    cabinWidth: 1.8,
    cabinZ: 0.65,
    wheelBase: 3.1,
    track: 1.68,
    wheelRadius: 0.44,
    mass: 1650,
    power: 9.5,
    topSpeed: 36,
    grip: 8.8,
    steering: 1.45,
  },
  sports: {
    id: 'sports',
    label: 'SPORTS',
    length: 4.3,
    width: 1.94,
    bodyBottom: 0.26,
    bodyHeight: 0.5,
    cabinHeight: 0.44,
    cabinLength: 1.7,
    cabinWidth: 1.64,
    cabinZ: -0.3,
    wheelBase: 2.55,
    track: 1.64,
    wheelRadius: 0.34,
    mass: 1050,
    power: 19,
    topSpeed: 58,
    grip: 12.5,
    steering: 2.05,
  },
};

export const CIVIL_PAINT: string[] = [
  '#e23b3b',
  '#2f6fd0',
  '#e8e2d4',
  '#1e2126',
  '#f0a63c',
  '#3fae6a',
  '#8f4fd0',
  '#b9c0c7',
  '#d94f9a',
  '#2fb3c9',
  '#6a6f76',
  '#c7b299',
];

export const bodyMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.26,
  metalness: 0.65,
});

export const glassMaterial = new THREE.MeshStandardMaterial({
  color: 0x0c1218,
  roughness: 0.08,
  metalness: 0.90,
  transparent: true,
  opacity: 0.86,
});

export const headlightMaterial = new THREE.MeshStandardMaterial({
  color: 0xfffae8,
  emissive: 0xfff4d0,
  emissiveIntensity: 1.15,
  roughness: 0.22,
  toneMapped: false,
});

export const tailMaterial = new THREE.MeshStandardMaterial({
  color: 0xff1e28,
  emissive: 0xff1020,
  emissiveIntensity: 0.65,
  roughness: 0.32,
  toneMapped: false,
});

export const wheelMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.52,
  metalness: 0.38,
});

function boxGeo(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

/** Geometry shared by every car of a given spec (cloned per car). */
const baseCache = new Map<
  string,
  {
    body: THREE.BufferGeometry;
    trim: THREE.BufferGeometry;
    glass: THREE.BufferGeometry;
    head: THREE.BufferGeometry;
    tail: THREE.BufferGeometry;
    wheel: THREE.BufferGeometry;
  }
>();

function baseFor(spec: CarSpec) {
  let cached = baseCache.get(spec.id);
  if (cached) return cached;

  const w = spec.width;
  const l = spec.length;

  // ── Painted Shell (panels receiving the primary paint color) ──
  const shellParts: THREE.BufferGeometry[] = [
    // Main lower chassis and rocker panels
    boxGeo(w * 0.94, spec.bodyHeight * 0.58, l * 0.94, 0, spec.bodyBottom + spec.bodyHeight * 0.32, 0),
    // Sloping front hood
    boxGeo(w * 0.90, spec.bodyHeight * 0.36, l * 0.30, 0, spec.bodyBottom + spec.bodyHeight * 0.72, l * 0.31),
    // Front nose fascia drop
    boxGeo(w * 0.88, spec.bodyHeight * 0.26, l * 0.08, 0, spec.bodyBottom + spec.bodyHeight * 0.62, l * 0.46),
    // Cabin roof panel
    boxGeo(spec.cabinWidth * 0.88, 0.06, spec.cabinLength * 0.80, 0, spec.bodyBottom + spec.bodyHeight + spec.cabinHeight, spec.cabinZ),
    // Muscular flared wheel arches
    boxGeo(0.06, spec.bodyHeight * 0.36, spec.wheelRadius * 2.2, w * 0.46, spec.bodyBottom + spec.bodyHeight * 0.42, spec.wheelBase / 2),
    boxGeo(0.06, spec.bodyHeight * 0.36, spec.wheelRadius * 2.2, -w * 0.46, spec.bodyBottom + spec.bodyHeight * 0.42, spec.wheelBase / 2),
    boxGeo(0.06, spec.bodyHeight * 0.36, spec.wheelRadius * 2.2, w * 0.46, spec.bodyBottom + spec.bodyHeight * 0.42, -spec.wheelBase / 2),
    boxGeo(0.06, spec.bodyHeight * 0.36, spec.wheelRadius * 2.2, -w * 0.46, spec.bodyBottom + spec.bodyHeight * 0.42, -spec.wheelBase / 2),
  ];

  if (spec.id !== 'pickup') {
    // Rear trunk decklid
    shellParts.push(boxGeo(w * 0.90, spec.bodyHeight * 0.34, l * 0.24, 0, spec.bodyBottom + spec.bodyHeight * 0.70, -l * 0.35));
  } else {
    // Open truck bed walls, floor, and tailgate
    shellParts.push(
      boxGeo(0.12, spec.bodyHeight * 0.52, l * 0.40, w * 0.42, spec.bodyBottom + spec.bodyHeight * 0.72, -l * 0.25),
      boxGeo(0.12, spec.bodyHeight * 0.52, l * 0.40, -w * 0.42, spec.bodyBottom + spec.bodyHeight * 0.72, -l * 0.25),
      boxGeo(w * 0.86, spec.bodyHeight * 0.50, 0.08, 0, spec.bodyBottom + spec.bodyHeight * 0.72, -l * 0.45),
      boxGeo(w * 0.80, 0.06, l * 0.38, 0, spec.bodyBottom + spec.bodyHeight * 0.48, -l * 0.25),
    );
  }

  if (spec.id === 'sports') {
    // Aerodynamic rear wing spoiler and hood cooling vents
    shellParts.push(
      boxGeo(w * 0.88, 0.05, 0.30, 0, spec.bodyBottom + spec.bodyHeight + 0.38, -l * 0.44),
      boxGeo(w * 0.42, 0.04, l * 0.16, 0, spec.bodyBottom + spec.bodyHeight * 0.92, l * 0.32),
    );
  } else if (spec.id === 'coupe') {
    // Performance ducktail rear lip and hood power bulge
    shellParts.push(
      boxGeo(w * 0.82, 0.08, 0.14, 0, spec.bodyBottom + spec.bodyHeight * 0.88, -l * 0.46),
      boxGeo(w * 0.35, 0.06, l * 0.22, 0, spec.bodyBottom + spec.bodyHeight * 0.92, l * 0.30),
    );
  } else if (spec.id === 'suv') {
    // Rear tailgate roof spoiler lip
    shellParts.push(
      boxGeo(spec.cabinWidth * 0.88, 0.06, 0.18, 0, spec.bodyBottom + spec.bodyHeight + spec.cabinHeight + 0.02, spec.cabinZ - spec.cabinLength / 2 - 0.06),
    );
  }

  const shell = mergeParts(shellParts);

  // ── Trim & Aero Accents (vertex-colored matte black, chrome, and graphite) ──
  const trimParts: THREE.BufferGeometry[] = [];

  // Front radiator grille (dark mesh)
  const grille = boxGeo(w * 0.62, spec.bodyHeight * 0.30, 0.06, 0, spec.bodyBottom + spec.bodyHeight * 0.48, l / 2 + 0.01);
  applyColor(grille, new THREE.Color('#121417'));
  trimParts.push(grille);

  // Front bumper bar & lower chin splitter
  const fBumper = boxGeo(w * 0.94, spec.bodyHeight * 0.20, 0.16, 0, spec.bodyBottom + spec.bodyHeight * 0.24, l / 2 + 0.01);
  applyColor(fBumper, new THREE.Color('#181a1e'));
  const fSplitter = boxGeo(w * 0.95, 0.06, 0.24, 0, spec.bodyBottom + 0.04, l / 2 - 0.04);
  applyColor(fSplitter, new THREE.Color('#181a1e'));
  trimParts.push(fBumper, fSplitter);

  // Rear bumper & aerodynamic diffuser
  const rBumper = boxGeo(w * 0.94, spec.bodyHeight * 0.24, 0.16, 0, spec.bodyBottom + spec.bodyHeight * 0.24, -l / 2 - 0.01);
  applyColor(rBumper, new THREE.Color('#181a1e'));
  const rDiffuser = boxGeo(w * 0.65, 0.06, 0.22, 0, spec.bodyBottom + 0.04, -l / 2 + 0.02);
  applyColor(rDiffuser, new THREE.Color('#181a1e'));
  trimParts.push(rBumper, rDiffuser);

  // Dual chrome exhaust pipes & hollow tips
  const exhaustL = boxGeo(0.12, 0.08, 0.22, w * 0.28, spec.bodyBottom + 0.12, -l / 2 - 0.04);
  applyColor(exhaustL, new THREE.Color('#d8dee9'));
  const exhaustLIn = boxGeo(0.08, 0.05, 0.05, w * 0.28, spec.bodyBottom + 0.12, -l / 2 - 0.13);
  applyColor(exhaustLIn, new THREE.Color('#0d0e10'));
  const exhaustR = boxGeo(0.12, 0.08, 0.22, -w * 0.28, spec.bodyBottom + 0.12, -l / 2 - 0.04);
  applyColor(exhaustR, new THREE.Color('#d8dee9'));
  const exhaustRIn = boxGeo(0.08, 0.05, 0.05, -w * 0.28, spec.bodyBottom + 0.12, -l / 2 - 0.13);
  applyColor(exhaustRIn, new THREE.Color('#0d0e10'));
  trimParts.push(exhaustL, exhaustLIn, exhaustR, exhaustRIn);

  // Aerodynamic side view mirrors
  const mirrorL = boxGeo(0.16, 0.10, 0.12, w / 2 + 0.08, spec.bodyBottom + spec.bodyHeight + 0.06, spec.cabinZ + spec.cabinLength * 0.36);
  applyColor(mirrorL, new THREE.Color('#181b20'));
  const glassL = boxGeo(0.12, 0.07, 0.02, w / 2 + 0.08, spec.bodyBottom + spec.bodyHeight + 0.06, spec.cabinZ + spec.cabinLength * 0.36 - 0.06);
  applyColor(glassL, new THREE.Color('#a0aab8'));

  const mirrorR = boxGeo(0.16, 0.10, 0.12, -w / 2 - 0.08, spec.bodyBottom + spec.bodyHeight + 0.06, spec.cabinZ + spec.cabinLength * 0.36);
  applyColor(mirrorR, new THREE.Color('#181b20'));
  const glassR = boxGeo(0.12, 0.07, 0.02, -w / 2 - 0.08, spec.bodyBottom + spec.bodyHeight + 0.06, spec.cabinZ + spec.cabinLength * 0.36 - 0.06);
  applyColor(glassR, new THREE.Color('#a0aab8'));
  trimParts.push(mirrorL, glassL, mirrorR, glassR);

  // Black B-pillars and window frames
  const bPillarL = boxGeo(0.04, spec.cabinHeight * 0.60, 0.10, spec.cabinWidth * 0.46, spec.bodyBottom + spec.bodyHeight + spec.cabinHeight * 0.36, spec.cabinZ);
  applyColor(bPillarL, new THREE.Color('#16181c'));
  const bPillarR = boxGeo(0.04, spec.cabinHeight * 0.60, 0.10, -spec.cabinWidth * 0.46, spec.bodyBottom + spec.bodyHeight + spec.cabinHeight * 0.36, spec.cabinZ);
  applyColor(bPillarR, new THREE.Color('#16181c'));
  trimParts.push(bPillarL, bPillarR);

  // Front and rear license plates (retro state cream/yellow plate with dark border frame)
  const fPlateBorder = boxGeo(0.44, 0.20, 0.03, 0, spec.bodyBottom + spec.bodyHeight * 0.24, l / 2 + 0.085);
  applyColor(fPlateBorder, new THREE.Color('#111315'));
  const fPlate = boxGeo(0.42, 0.18, 0.04, 0, spec.bodyBottom + spec.bodyHeight * 0.24, l / 2 + 0.095);
  applyColor(fPlate, new THREE.Color('#fef2b8'));

  const rPlateBorder = boxGeo(0.44, 0.20, 0.03, 0, spec.bodyBottom + spec.bodyHeight * 0.24, -l / 2 - 0.085);
  applyColor(rPlateBorder, new THREE.Color('#111315'));
  const rPlate = boxGeo(0.42, 0.18, 0.04, 0, spec.bodyBottom + spec.bodyHeight * 0.24, -l / 2 - 0.095);
  applyColor(rPlate, new THREE.Color('#fef2b8'));
  trimParts.push(fPlateBorder, fPlate, rPlateBorder, rPlate);

  // Interior dashboard and steering wheel column (positioned under the windshield)
  const dashBody = boxGeo(
    spec.cabinWidth * 0.82,
    0.18,
    spec.cabinLength * 0.28,
    0,
    spec.bodyBottom + spec.bodyHeight + 0.04,
    spec.cabinZ + spec.cabinLength * 0.26,
  );
  applyColor(dashBody, new THREE.Color('#1a1c20'));

  const gaugeBinnacle = boxGeo(
    0.28,
    0.08,
    0.16,
    spec.cabinWidth * 0.24,
    spec.bodyBottom + spec.bodyHeight + 0.14,
    spec.cabinZ + spec.cabinLength * 0.22,
  );
  applyColor(gaugeBinnacle, new THREE.Color('#121316'));

  const gaugeDisplay = boxGeo(
    0.24,
    0.05,
    0.02,
    spec.cabinWidth * 0.24,
    spec.bodyBottom + spec.bodyHeight + 0.14,
    spec.cabinZ + spec.cabinLength * 0.22 - 0.08,
  );
  applyColor(gaugeDisplay, new THREE.Color('#38bdf8'));

  const steeringCol = boxGeo(
    0.06,
    0.06,
    0.18,
    spec.cabinWidth * 0.24,
    spec.bodyBottom + spec.bodyHeight + 0.10,
    spec.cabinZ + spec.cabinLength * 0.14,
  );
  applyColor(steeringCol, new THREE.Color('#15171a'));

  const steeringWheel = boxGeo(
    0.24,
    0.24,
    0.03,
    spec.cabinWidth * 0.24,
    spec.bodyBottom + spec.bodyHeight + 0.15,
    spec.cabinZ + spec.cabinLength * 0.06,
  );
  applyColor(steeringWheel, new THREE.Color('#1e2025'));

  const centerConsole = boxGeo(
    0.16,
    0.22,
    0.26,
    0,
    spec.bodyBottom + spec.bodyHeight * 0.70,
    spec.cabinZ + spec.cabinLength * 0.14,
  );
  applyColor(centerConsole, new THREE.Color('#141518'));

  trimParts.push(dashBody, gaugeBinnacle, gaugeDisplay, steeringCol, steeringWheel, centerConsole);

  // Thin dark door seam lines along both sides
  for (const side of [1, -1]) {
    const sideX = side * (w * 0.471);
    const seamFront = boxGeo(
      0.012,
      spec.bodyHeight * 0.52,
      0.02,
      sideX,
      spec.bodyBottom + spec.bodyHeight * 0.48,
      spec.cabinZ + spec.cabinLength * 0.35,
    );
    applyColor(seamFront, new THREE.Color('#0c0e12'));
    const seamRear = boxGeo(
      0.012,
      spec.bodyHeight * 0.52,
      0.02,
      sideX,
      spec.bodyBottom + spec.bodyHeight * 0.48,
      spec.cabinZ - spec.cabinLength * 0.35,
    );
    applyColor(seamRear, new THREE.Color('#0c0e12'));
    const seamLower = boxGeo(
      0.012,
      0.018,
      spec.cabinLength * 0.72,
      sideX,
      spec.bodyBottom + spec.bodyHeight * 0.22,
      spec.cabinZ,
    );
    applyColor(seamLower, new THREE.Color('#0c0e12'));

    trimParts.push(seamFront, seamRear, seamLower);

    if (spec.id !== 'sports' && spec.id !== 'coupe') {
      const seamMid = boxGeo(
        0.012,
        spec.bodyHeight * 0.50,
        0.02,
        sideX,
        spec.bodyBottom + spec.bodyHeight * 0.47,
        spec.cabinZ,
      );
      applyColor(seamMid, new THREE.Color('#0c0e12'));
      trimParts.push(seamMid);
    }
  }

  // Recessed door handles along sides
  for (const side of [1, -1]) {
    const sideX = side * (w * 0.472);
    const handleY = spec.bodyBottom + spec.bodyHeight * 0.68;
    const isTwoDoor = spec.id === 'sports' || spec.id === 'coupe';
    const frontHandleZ = isTwoDoor ? spec.cabinZ - 0.06 : spec.cabinZ + spec.cabinLength * 0.12;

    const fPocket = boxGeo(0.015, 0.045, 0.13, sideX, handleY, frontHandleZ);
    applyColor(fPocket, new THREE.Color('#0c0d10'));
    const fBar = boxGeo(0.022, 0.020, 0.09, sideX + side * 0.002, handleY, frontHandleZ);
    applyColor(fBar, new THREE.Color('#c2cad4'));
    trimParts.push(fPocket, fBar);

    if (!isTwoDoor) {
      const rearHandleZ = spec.cabinZ - spec.cabinLength * 0.24;
      const rPocket = boxGeo(0.015, 0.045, 0.13, sideX, handleY, rearHandleZ);
      applyColor(rPocket, new THREE.Color('#0c0d10'));
      const rBar = boxGeo(0.022, 0.020, 0.09, sideX + side * 0.002, handleY, rearHandleZ);
      applyColor(rBar, new THREE.Color('#c2cad4'));
      trimParts.push(rPocket, rBar);
    }
  }

  if (spec.id === 'sports') {
    const stanchionL = boxGeo(0.05, 0.24, 0.10, w * 0.25, spec.bodyBottom + spec.bodyHeight + 0.24, -l * 0.44);
    applyColor(stanchionL, new THREE.Color('#141619'));
    const stanchionR = boxGeo(0.05, 0.24, 0.10, -w * 0.25, spec.bodyBottom + spec.bodyHeight + 0.24, -l * 0.44);
    applyColor(stanchionR, new THREE.Color('#141619'));
    const wingletL = boxGeo(0.05, 0.12, 0.24, w * 0.48, spec.bodyBottom + 0.08, l / 2 - 0.06);
    applyColor(wingletL, new THREE.Color('#141619'));
    const wingletR = boxGeo(0.05, 0.12, 0.24, -w * 0.48, spec.bodyBottom + 0.08, l / 2 - 0.06);
    applyColor(wingletR, new THREE.Color('#141619'));
    trimParts.push(stanchionL, stanchionR, wingletL, wingletR);

    // Side air intake scoops on rear quarter panels
    for (const side of [1, -1]) {
      const scoopDuct = boxGeo(0.04, 0.22, 0.34, side * (w * 0.482), spec.bodyBottom + spec.bodyHeight * 0.42, -0.85);
      applyColor(scoopDuct, new THREE.Color('#15171b'));
      const scoopMouth = boxGeo(0.035, 0.18, 0.05, side * (w * 0.485), spec.bodyBottom + spec.bodyHeight * 0.42, -0.68);
      applyColor(scoopMouth, new THREE.Color('#08090a'));
      const strakeTop = boxGeo(0.038, 0.018, 0.26, side * (w * 0.488), spec.bodyBottom + spec.bodyHeight * 0.48, -0.82);
      applyColor(strakeTop, new THREE.Color('#1b1e24'));
      const strakeBottom = boxGeo(0.038, 0.018, 0.26, side * (w * 0.488), spec.bodyBottom + spec.bodyHeight * 0.36, -0.82);
      applyColor(strakeBottom, new THREE.Color('#1b1e24'));
      trimParts.push(scoopDuct, scoopMouth, strakeTop, strakeBottom);
    }
  } else if (spec.id === 'coupe') {
    // Subtle performance hood scoop
    const scoopCowl = boxGeo(w * 0.26, 0.045, 0.32, 0, spec.bodyBottom + spec.bodyHeight * 0.95, l * 0.28);
    applyColor(scoopCowl, new THREE.Color('#181b20'));
    const scoopMouth = boxGeo(w * 0.22, 0.025, 0.04, 0, spec.bodyBottom + spec.bodyHeight * 0.945, l * 0.28 + 0.16);
    applyColor(scoopMouth, new THREE.Color('#08090b'));

    // Twin exhaust tips (forming dual-twin exhaust quad setup)
    const exhaustL2 = boxGeo(0.10, 0.08, 0.22, w * 0.18, spec.bodyBottom + 0.12, -l / 2 - 0.04);
    applyColor(exhaustL2, new THREE.Color('#d8dee9'));
    const exhaustL2In = boxGeo(0.06, 0.05, 0.05, w * 0.18, spec.bodyBottom + 0.12, -l / 2 - 0.13);
    applyColor(exhaustL2In, new THREE.Color('#0d0e10'));
    const exhaustR2 = boxGeo(0.10, 0.08, 0.22, -w * 0.18, spec.bodyBottom + 0.12, -l / 2 - 0.04);
    applyColor(exhaustR2, new THREE.Color('#d8dee9'));
    const exhaustR2In = boxGeo(0.06, 0.05, 0.05, -w * 0.18, spec.bodyBottom + 0.12, -l / 2 - 0.13);
    applyColor(exhaustR2In, new THREE.Color('#0d0e10'));

    trimParts.push(scoopCowl, scoopMouth, exhaustL2, exhaustL2In, exhaustR2, exhaustR2In);
  } else if (spec.id === 'suv') {
    const railL = boxGeo(0.05, 0.05, spec.cabinLength * 0.85, spec.cabinWidth * 0.40, spec.bodyBottom + spec.bodyHeight + spec.cabinHeight + 0.06, spec.cabinZ);
    applyColor(railL, new THREE.Color('#b0b6c0'));
    const railR = boxGeo(0.05, 0.05, spec.cabinLength * 0.85, -spec.cabinWidth * 0.40, spec.bodyBottom + spec.bodyHeight + spec.cabinHeight + 0.06, spec.cabinZ);
    applyColor(railR, new THREE.Color('#b0b6c0'));
    const stepL = boxGeo(0.10, 0.04, spec.wheelBase * 0.70, w * 0.48, spec.bodyBottom * 0.75, 0);
    applyColor(stepL, new THREE.Color('#22262c'));
    const stepR = boxGeo(0.10, 0.04, spec.wheelBase * 0.70, -w * 0.48, spec.bodyBottom * 0.75, 0);
    applyColor(stepR, new THREE.Color('#22262c'));
    trimParts.push(railL, railR, stepL, stepR);
  }

  const trim = mergeParts(trimParts);

  // ── Glass Greenhouse (windshield, side panes, and rear window) ──
  const glassParts: THREE.BufferGeometry[] = [
    // Raked front windshield
    boxGeo(spec.cabinWidth * 0.88, spec.cabinHeight * 0.65, spec.cabinLength * 0.34, 0, spec.bodyBottom + spec.bodyHeight + spec.cabinHeight * 0.32, spec.cabinZ + spec.cabinLength * 0.30),
    // Side windows
    boxGeo(spec.cabinWidth * 0.92, spec.cabinHeight * 0.58, spec.cabinLength * 0.65, 0, spec.bodyBottom + spec.bodyHeight + spec.cabinHeight * 0.34, spec.cabinZ),
  ];

  if (spec.id !== 'pickup') {
    // Raked rear backlite
    glassParts.push(
      boxGeo(spec.cabinWidth * 0.86, spec.cabinHeight * 0.60, spec.cabinLength * 0.30, 0, spec.bodyBottom + spec.bodyHeight + spec.cabinHeight * 0.30, spec.cabinZ - spec.cabinLength * 0.32),
    );
  } else {
    // Pickup vertical cab back window
    glassParts.push(
      boxGeo(spec.cabinWidth * 0.84, spec.cabinHeight * 0.52, 0.06, 0, spec.bodyBottom + spec.bodyHeight + spec.cabinHeight * 0.34, spec.cabinZ - spec.cabinLength * 0.46),
    );
  }
  const glass = mergeParts(glassParts);

  // ── Headlights (dual projector lenses + amber corner signals) ──
  const head = mergeParts([
    boxGeo(0.38, 0.16, 0.10, w * 0.30, spec.bodyBottom + spec.bodyHeight * 0.66, l / 2 - 0.03),
    boxGeo(0.38, 0.16, 0.10, -w * 0.30, spec.bodyBottom + spec.bodyHeight * 0.66, l / 2 - 0.03),
    boxGeo(0.08, 0.14, 0.08, w * 0.44, spec.bodyBottom + spec.bodyHeight * 0.66, l / 2 - 0.03),
    boxGeo(0.08, 0.14, 0.08, -w * 0.44, spec.bodyBottom + spec.bodyHeight * 0.66, l / 2 - 0.03),
  ]);

  // ── Taillights (horizontal LED strip clusters) ──
  const tail = mergeParts([
    boxGeo(0.38, 0.14, 0.08, w * 0.30, spec.bodyBottom + spec.bodyHeight * 0.66, -l / 2 + 0.03),
    boxGeo(0.38, 0.14, 0.08, -w * 0.30, spec.bodyBottom + spec.bodyHeight * 0.66, -l / 2 + 0.03),
    boxGeo(w * 0.32, 0.06, 0.06, 0, spec.bodyBottom + spec.bodyHeight * 0.68, -l / 2 + 0.03),
  ]);

  // ── Wheels (tyre + brake rotor + caliper + 5-spoke alloy rim) ──
  const wheelParts: THREE.BufferGeometry[] = [];

  // Outer tyre tread and sidewalls
  const tyre = new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, 0.26, 16);
  tyre.rotateZ(Math.PI / 2);
  applyColor(tyre, new THREE.Color('#16181b'));
  wheelParts.push(tyre);

  // Rim barrel lip
  const rimLip = new THREE.CylinderGeometry(spec.wheelRadius * 0.62, spec.wheelRadius * 0.62, 0.28, 14);
  rimLip.rotateZ(Math.PI / 2);
  applyColor(rimLip, new THREE.Color('#cfd5de'));
  wheelParts.push(rimLip);

  // Steel brake rotor disc
  const rotor = new THREE.CylinderGeometry(spec.wheelRadius * 0.54, spec.wheelRadius * 0.54, 0.08, 12);
  rotor.rotateZ(Math.PI / 2);
  applyColor(rotor, new THREE.Color('#8a9098'));
  wheelParts.push(rotor);

  // Sport red brake caliper
  const caliper = boxGeo(0.12, spec.wheelRadius * 0.30, spec.wheelRadius * 0.16, 0, spec.wheelRadius * 0.34, 0);
  applyColor(caliper, new THREE.Color('#d62828'));
  wheelParts.push(caliper);

  // Center hub
  const hub = new THREE.CylinderGeometry(spec.wheelRadius * 0.20, spec.wheelRadius * 0.20, 0.30, 10);
  hub.rotateZ(Math.PI / 2);
  applyColor(hub, new THREE.Color('#22262d'));
  wheelParts.push(hub);

  // 5 machined alloy spokes
  const midR = spec.wheelRadius * 0.34;
  for (let k = 0; k < 5; k++) {
    const theta = (k * Math.PI * 2) / 5;
    const spoke = new THREE.BoxGeometry(0.27, 0.05, spec.wheelRadius * 0.42);
    spoke.rotateX(theta);
    spoke.translate(0, Math.sin(theta) * midR, Math.cos(theta) * midR);
    applyColor(spoke, new THREE.Color('#c5ccd6'));
    wheelParts.push(spoke);
  }

  const wheel = mergeParts(wheelParts);

  cached = { body: shell, trim, glass, head, tail, wheel };
  baseCache.set(spec.id, cached);
  return cached;
}

/** Per-livery paint and trim assembly for the body. */
function paintShell(spec: CarSpec, paint: string, livery: Livery): THREE.BufferGeometry {
  const base = baseFor(spec);
  const geo = base.body.clone();
  const color = new THREE.Color(paint);
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));

  const extraParts: THREE.BufferGeometry[] = [geo, base.trim.clone()];

  if (livery === 'police') {
    // White doors, roof lightbar, front bullbar
    const roofY = spec.bodyBottom + spec.bodyHeight + spec.cabinHeight + 0.12;
    const doorWhiteL = boxGeo(0.04, spec.bodyHeight * 0.44, spec.length * 0.38, spec.width * 0.48, spec.bodyBottom + spec.bodyHeight * 0.44, 0.05);
    applyColor(doorWhiteL, new THREE.Color('#f4f6fa'));
    extraParts.push(doorWhiteL);

    const doorWhiteR = boxGeo(0.04, spec.bodyHeight * 0.44, spec.length * 0.38, -spec.width * 0.48, spec.bodyBottom + spec.bodyHeight * 0.44, 0.05);
    applyColor(doorWhiteR, new THREE.Color('#f4f6fa'));
    extraParts.push(doorWhiteR);

    // Roof lightbar mount
    const barMount = boxGeo(spec.cabinWidth * 0.76, 0.05, 0.16, 0, roofY - 0.05, spec.cabinZ);
    applyColor(barMount, new THREE.Color('#14171d'));
    extraParts.push(barMount);

    // Red emergency strobe (left)
    const redBar = boxGeo(spec.cabinWidth * 0.34, 0.12, 0.22, -spec.cabinWidth * 0.20, roofY, spec.cabinZ);
    applyColor(redBar, new THREE.Color('#ff1838'));
    extraParts.push(redBar);

    // Blue emergency strobe (right)
    const blueBar = boxGeo(spec.cabinWidth * 0.34, 0.12, 0.22, spec.cabinWidth * 0.20, roofY, spec.cabinZ);
    applyColor(blueBar, new THREE.Color('#0077ff'));
    extraParts.push(blueBar);

    // Center takedown
    const takedown = boxGeo(spec.cabinWidth * 0.10, 0.10, 0.20, 0, roofY, spec.cabinZ);
    applyColor(takedown, new THREE.Color('#f0f4ff'));
    extraParts.push(takedown);

    // Front heavy-duty push-bar / bullbar with vertical uprights and dual crossbars
    const bullBarL = boxGeo(0.07, 0.40, 0.18, spec.width * 0.22, spec.bodyBottom + spec.bodyHeight * 0.36, spec.length / 2 + 0.11);
    applyColor(bullBarL, new THREE.Color('#15171b'));
    const bullBarR = boxGeo(0.07, 0.40, 0.18, -spec.width * 0.22, spec.bodyBottom + spec.bodyHeight * 0.36, spec.length / 2 + 0.11);
    applyColor(bullBarR, new THREE.Color('#15171b'));

    const padL = boxGeo(0.08, 0.38, 0.04, spec.width * 0.22, spec.bodyBottom + spec.bodyHeight * 0.36, spec.length / 2 + 0.205);
    applyColor(padL, new THREE.Color('#262930'));
    const padR = boxGeo(0.08, 0.38, 0.04, -spec.width * 0.22, spec.bodyBottom + spec.bodyHeight * 0.36, spec.length / 2 + 0.205);
    applyColor(padR, new THREE.Color('#262930'));

    const crossBarLow = boxGeo(spec.width * 0.50, 0.055, 0.08, 0, spec.bodyBottom + spec.bodyHeight * 0.26, spec.length / 2 + 0.15);
    applyColor(crossBarLow, new THREE.Color('#15171b'));
    const crossBarHigh = boxGeo(spec.width * 0.50, 0.055, 0.08, 0, spec.bodyBottom + spec.bodyHeight * 0.46, spec.length / 2 + 0.15);
    applyColor(crossBarHigh, new THREE.Color('#15171b'));

    const wingL = boxGeo(spec.width * 0.24, 0.04, 0.05, spec.width * 0.36, spec.bodyBottom + spec.bodyHeight * 0.38, spec.length / 2 + 0.12);
    applyColor(wingL, new THREE.Color('#181b20'));
    const wingR = boxGeo(spec.width * 0.24, 0.04, 0.05, -spec.width * 0.36, spec.bodyBottom + spec.bodyHeight * 0.38, spec.length / 2 + 0.12);
    applyColor(wingR, new THREE.Color('#181b20'));

    extraParts.push(bullBarL, bullBarR, padL, padR, crossBarLow, crossBarHigh, wingL, wingR);

    // Driver's side A-pillar spotlight (left-hand side in US)
    const spotY = spec.bodyBottom + spec.bodyHeight + spec.cabinHeight * 0.28;
    const spotZ = spec.cabinZ + spec.cabinLength * 0.34;
    const spotArm = boxGeo(0.10, 0.03, 0.03, spec.cabinWidth * 0.49, spotY, spotZ);
    applyColor(spotArm, new THREE.Color('#16181c'));
    const spotHousing = boxGeo(0.11, 0.11, 0.13, spec.cabinWidth * 0.55, spotY, spotZ + 0.04);
    applyColor(spotHousing, new THREE.Color('#111215'));
    const spotLens = boxGeo(0.09, 0.09, 0.02, spec.cabinWidth * 0.55, spotY, spotZ + 0.11);
    applyColor(spotLens, new THREE.Color('#fff8db'));
    const spotPivot = boxGeo(0.04, 0.07, 0.04, spec.cabinWidth * 0.55, spotY - 0.03, spotZ - 0.04);
    applyColor(spotPivot, new THREE.Color('#c8d0da'));

    extraParts.push(spotArm, spotHousing, spotLens, spotPivot);
  } else if (livery === 'taxi') {
    // Checkerboard stripe along the doors
    const checkerL = boxGeo(0.04, spec.bodyHeight * 0.14, spec.length * 0.65, spec.width * 0.48, spec.bodyBottom + spec.bodyHeight * 0.48, 0);
    applyColor(checkerL, new THREE.Color('#15181c'));
    extraParts.push(checkerL);

    const checkerR = boxGeo(0.04, spec.bodyHeight * 0.14, spec.length * 0.65, -spec.width * 0.48, spec.bodyBottom + spec.bodyHeight * 0.48, 0);
    applyColor(checkerR, new THREE.Color('#15181c'));
    extraParts.push(checkerR);

    // Illuminated roof TAXI medallion sign with black "TAXI" lettering bars and amber glow tint
    const roofY = spec.bodyBottom + spec.bodyHeight + spec.cabinHeight + 0.12;

    const taxiBase = boxGeo(spec.cabinWidth * 0.46, 0.03, 0.28, 0, roofY - 0.07, spec.cabinZ);
    applyColor(taxiBase, new THREE.Color('#181b20'));

    const footL = boxGeo(0.04, 0.05, 0.22, spec.cabinWidth * 0.21, roofY - 0.07, spec.cabinZ);
    applyColor(footL, new THREE.Color('#111214'));
    const footR = boxGeo(0.04, 0.05, 0.22, -spec.cabinWidth * 0.21, roofY - 0.07, spec.cabinZ);
    applyColor(footR, new THREE.Color('#111214'));

    const taxiBox = boxGeo(spec.cabinWidth * 0.42, 0.15, 0.24, 0, roofY, spec.cabinZ);
    applyColor(taxiBox, new THREE.Color('#ffaa00'));

    // Black "TAXI" lettering bars on front and rear faces
    const taxiBarFront = boxGeo(spec.cabinWidth * 0.32, 0.065, 0.02, 0, roofY, spec.cabinZ + 0.125);
    applyColor(taxiBarFront, new THREE.Color('#111214'));
    const taxiBarRear = boxGeo(spec.cabinWidth * 0.32, 0.065, 0.02, 0, roofY, spec.cabinZ - 0.125);
    applyColor(taxiBarRear, new THREE.Color('#111214'));

    // Amber medallion crown flasher
    const taxiBeacon = boxGeo(spec.cabinWidth * 0.14, 0.04, 0.12, 0, roofY + 0.09, spec.cabinZ);
    applyColor(taxiBeacon, new THREE.Color('#ff7700'));

    extraParts.push(taxiBase, footL, footR, taxiBox, taxiBarFront, taxiBarRear, taxiBeacon);
  }

  return mergeParts(extraParts);
}

export interface CarVisual {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  bodyMesh: THREE.Mesh;
  tailMaterial: THREE.MeshStandardMaterial;
}

/** Build a ready-to-use car group. The model faces +Z. */
export function createCarVisual(spec: CarSpec, paint: string, livery: Livery = 'civil'): CarVisual {
  const group = new THREE.Group();
  const base = baseFor(spec);

  const bodyMesh = new THREE.Mesh(paintShell(spec, paint, livery), bodyMaterial);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  const glassMesh = new THREE.Mesh(base.glass.clone(), glassMaterial);
  glassMesh.castShadow = false;
  bodyMesh.add(glassMesh);

  const headMesh = new THREE.Mesh(base.head.clone(), headlightMaterial);
  bodyMesh.add(headMesh);

  const tailMesh = new THREE.Mesh(base.tail.clone(), tailMaterial.clone());
  bodyMesh.add(tailMesh);

  const wheels: THREE.Mesh[] = [];
  const wheelPositions: [number, number][] = [
    [spec.track / 2, spec.wheelBase / 2],
    [-spec.track / 2, spec.wheelBase / 2],
    [spec.track / 2, -spec.wheelBase / 2],
    [-spec.track / 2, -spec.wheelBase / 2],
  ];
  for (const [x, z] of wheelPositions) {
    const wheel = new THREE.Mesh(base.wheel.clone(), wheelMaterial);
    wheel.position.set(x, spec.wheelRadius, z);
    wheel.castShadow = true;
    group.add(wheel);
    wheels.push(wheel);
  }

  // Body shadow blob keeps the car grounded even with shadows disabled.
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(spec.length * 0.42, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  blob.renderOrder = -1;
  group.add(blob);

  return { group, wheels, bodyMesh, tailMaterial: tailMesh.material as THREE.MeshStandardMaterial };
}

export function disposeCarGeometry(): void {
  for (const entry of baseCache.values()) {
    entry.body.dispose();
    entry.trim.dispose();
    entry.glass.dispose();
    entry.head.dispose();
    entry.tail.dispose();
    entry.wheel.dispose();
  }
  baseCache.clear();
}
