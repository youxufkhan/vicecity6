/**
 * Turns SolidCraft GLB exports into compact runtime models.
 *
 *   node scripts/models/optimize.mjs <in.glb> <out.json> <budget:name=tris,...>
 *
 * - applies the root node transform (CAD Z-up mm -> Y-up m) and a -90deg yaw so the model faces +Z
 * - merges vertices and decimates each part to its triangle budget
 * - bakes each part's material colour (linear RGB) so the game can use vertex colours
 * Output: { parts: [{ group, color, pos (mm, int), idx }] } with groups body|trim|glass|head|tail|wheel.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';

const [, , input, output, budgetArg = ''] = process.argv;
const budgets = Object.fromEntries(budgetArg.split(',').filter(Boolean).map((s) => s.split('=')).map(([k, v]) => [k, Number(v)]));

const buf = readFileSync(input);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
const binStart = 20 + jsonLen + 8;
const bin = buf.slice(binStart);

function readAccessor(i) {
  const a = gltf.accessors[i];
  const v = gltf.bufferViews[a.bufferView];
  const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const comps = { SCALAR: 1, VEC3: 3 }[a.type];
  const Ctor = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[a.componentType];
  const out = new Ctor(a.count * comps);
  const dv = new DataView(bin.buffer, bin.byteOffset + off, a.count * comps * Ctor.BYTES_PER_ELEMENT);
  for (let k = 0; k < out.length; k++) {
    out[k] = Ctor === Float32Array ? dv.getFloat32(k * 4, true) : Ctor === Uint32Array ? dv.getUint32(k * 4, true) : dv.getUint16(k * 2, true);
  }
  return out;
}

const root = gltf.nodes[0];
const q = new THREE.Quaternion(...(root.rotation ?? [0, 0, 0, 1]));
const s = root.scale ?? [1, 1, 1];
const m = new THREE.Matrix4().compose(new THREE.Vector3(), q, new THREE.Vector3(...s));
m.premultiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)); // forward +X -> +Z

const groupOf = (n) => /^Gun/.test(n) ? 'gun' : /^Soft/.test(n) ? 'soft' : /^(Body|Roof)/.test(n) ? 'body' : /^Trim/.test(n) ? 'trim' : /^Glass/.test(n) ? 'glass'
  : /^Head/.test(n) ? 'head' : /^Tail/.test(n) ? 'tail' : /^(Tyre|Rim|Disc|Hub)/.test(n) ? 'wheel' : 'trim';

const simplifier = new SimplifyModifier();
const parts = [];
for (const node of gltf.nodes.filter((n) => n.mesh !== undefined)) {
  const mesh = gltf.meshes[node.mesh];
  for (const prim of mesh.primitives) {
    const pos = readAccessor(prim.attributes.POSITION);
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (prim.indices !== undefined) geo.setIndex(new THREE.BufferAttribute(readAccessor(prim.indices), 1));
    geo.applyMatrix4(m);
    if (/^Soft/.test(node.name)) { // unit shapes: recentre on their own bounding box
      geo.computeBoundingBox();
      const c = geo.boundingBox.getCenter(new THREE.Vector3());
      geo.translate(-c.x, -c.y, -c.z);
    }
    geo = mergeVertices(geo, 1e-4);
    const target = budgets[node.name] ?? budgets[node.name.replace(/\d+$/, '')];
    const tris = geo.index.count / 3;
    if (target && tris > target) {
      const remove = Math.floor((tris - target) / 2); // each collapse removes ~2 triangles
      geo = simplifier.modify(geo, Math.min(remove, geo.attributes.position.count - 8));
      geo = mergeVertices(geo, 1e-4);
    }
    const mat = gltf.materials[prim.material].pbrMetallicRoughness;
    const p = geo.attributes.position.array;
    parts.push({
      group: groupOf(node.name),
      name: node.name,
      color: mat.baseColorFactor.slice(0, 3).map((c) => Math.round(c * 1000) / 1000),
      metal: mat.metallicFactor ?? 0,
      rough: mat.roughnessFactor ?? 1,
      pos: Array.from(p, (v) => Math.round(v * 1000)),
      idx: Array.from(geo.index.array),
    });
    console.log(node.name.padEnd(8), `${tris} -> ${geo.index.count / 3} tris`);
  }
}
// Roof reference point so livery props (light bars, taxi sign) sit on the real roof.
const roof = parts.find((p) => p.name === 'Roof');
let meta = {};
if (roof) {
  const ys = roof.pos.filter((_, i) => i % 3 === 1);
  const zs = roof.pos.filter((_, i) => i % 3 === 2);
  meta = { roofTop: Math.max(...ys) / 1000, roofZ: (Math.max(...zs) + Math.min(...zs)) / 2000 };
}
const text = JSON.stringify({ meta, parts });
writeFileSync(output, text);
console.log('wrote', output, `${(text.length / 1024).toFixed(0)} KB`, JSON.stringify(meta));
