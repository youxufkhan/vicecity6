/**
 * City layout: the static geometry plan of the world.
 *
 * The city is a regular grid of blocks separated by roads. Everything else
 * (buildings, props, traffic routes) is derived from this description so the
 * road network and the collision boxes can never disagree.
 */

export const ROAD_WIDTH = 16;
export const LANE_OFFSET = 4.2;
export const STOP_LINE_OFFSET = ROAD_WIDTH / 2 + 8.5;
export const BLOCK_SIZE = 66;
export const SIDEWALK_WIDTH = 4.5;
export const CELL = BLOCK_SIZE + ROAD_WIDTH; // 82
export const COLS = 7; // road lines along X
export const ROWS = 7; // road lines along Z
export const HALF_X = (COLS * CELL) / 2;
export const HALF_Z = (ROWS * CELL) / 2;
export const BEACH_DEPTH = 90;
export const WORLD_MARGIN = 150;

export type District = 'downtown' | 'uptown' | 'industrial' | 'suburb' | 'beach';

export interface Block {
  col: number;
  row: number;
  cx: number;
  cz: number;
  /** Full block rectangle (includes the sidewalk ring). */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Buildable lot rectangle (inside the sidewalk ring). */
  lotMinX: number;
  lotMaxX: number;
  lotMinZ: number;
  lotMaxZ: number;
  district: District;
}

export function districtOf(col: number, row: number): District {
  if (col <= 1) return 'industrial';
  if (row >= 5) return 'beach';
  if (col >= 5) return 'suburb';
  if (row <= 1) return 'uptown';
  return 'downtown';
}

export function roadCenterX(col: number): number {
  return (col - (COLS - 1) / 2) * CELL;
}

export function roadCenterZ(row: number): number {
  return (row - (ROWS - 1) / 2) * CELL;
}

export function buildBlocks(): Block[] {
  const blocks: Block[] = [];
  for (let row = 0; row < ROWS - 1; row++) {
    for (let col = 0; col < COLS - 1; col++) {
      const minX = roadCenterX(col) + ROAD_WIDTH / 2;
      const maxX = roadCenterX(col + 1) - ROAD_WIDTH / 2;
      const minZ = roadCenterZ(row) + ROAD_WIDTH / 2;
      const maxZ = roadCenterZ(row + 1) - ROAD_WIDTH / 2;
      blocks.push({
        col,
        row,
        cx: (minX + maxX) / 2,
        cz: (minZ + maxZ) / 2,
        minX,
        maxX,
        minZ,
        maxZ,
        lotMinX: minX + SIDEWALK_WIDTH,
        lotMaxX: maxX - SIDEWALK_WIDTH,
        lotMinZ: minZ + SIDEWALK_WIDTH,
        lotMaxZ: maxZ - SIDEWALK_WIDTH,
        district: districtOf(col, row),
      });
    }
  }
  return blocks;
}

/* ─────────────────────────── road network ─────────────────────────── */

export interface RoadNode {
  id: number;
  col: number;
  row: number;
  x: number;
  z: number;
  edges: number[];
  /** Phase offset so neighbouring intersections are not in lockstep. */
  signalOffset: number;
  /** Traffic signal cycle duration (s), scaled by intersection density. */
  cycleLength: number;
}

export interface RoadEdge {
  id: number;
  a: number;
  b: number;
  /** Unit direction from a to b. */
  dx: number;
  dz: number;
  axis: 'x' | 'z';
  length: number;
}

export class RoadNetwork {
  readonly nodes: RoadNode[] = [];
  readonly edges: RoadEdge[] = [];

  constructor() {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const centerDist = Math.hypot(col - 3, row - 3);
        const cycleLength = Math.round(17 - Math.min(3, centerDist) * 2);
        this.nodes.push({
          id: this.nodes.length,
          col,
          row,
          x: roadCenterX(col),
          z: roadCenterZ(row),
          edges: [],
          signalOffset: (col * 3 + row * 5) % 7,
          cycleLength,
        });
      }
    }
    const nodeIndex = (col: number, row: number) => row * COLS + col;

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const a = nodeIndex(col, row);
        if (col + 1 < COLS) this.addEdge(a, nodeIndex(col + 1, row), 'x');
        if (row + 1 < ROWS) this.addEdge(a, nodeIndex(col, row + 1), 'z');
      }
    }
  }

  private addEdge(a: number, b: number, axis: 'x' | 'z'): void {
    const na = this.nodes[a];
    const nb = this.nodes[b];
    const dx = nb.x - na.x;
    const dz = nb.z - na.z;
    const len = Math.hypot(dx, dz);
    const id = this.edges.length;
    this.edges.push({ id, a, b, dx: dx / len, dz: dz / len, axis, length: len });
    na.edges.push(id);
    nb.edges.push(id);
  }

  otherEnd(edgeId: number, nodeId: number): number {
    const e = this.edges[edgeId];
    return e.a === nodeId ? e.b : e.a;
  }

  /** Direction of travel from `from` to `to` along an edge. */
  edgeDirection(edgeId: number, from: number): { dx: number; dz: number } {
    const e = this.edges[edgeId];
    if (e.a === from) return { dx: e.dx, dz: e.dz };
    return { dx: -e.dx, dz: -e.dz };
  }

  /** Right-hand lane centre point for travelling from `from` to `to`. */
  lanePoint(edgeId: number, from: number, out: { x: number; z: number }): void {
    const forward = this.edgeDirection(edgeId, from);
    // right = forward x up  (for XZ: right = (-dz, dx))
    const rx = -forward.dz;
    const rz = forward.dx;
    const to = this.nodes[this.otherEnd(edgeId, from)];
    out.x = to.x + rx * LANE_OFFSET;
    out.z = to.z + rz * LANE_OFFSET;
  }

  /** Pick the next edge to follow, preferring to continue straight. */
  nextEdge(nodeId: number, currentEdge: number | null, random: () => number): number {
    const node = this.nodes[nodeId];
    const options = node.edges.filter((e) => e !== currentEdge);
    if (options.length === 0) return node.edges[0];
    const current = currentEdge === null ? null : this.edges[currentEdge];
    if (current) {
      const inbound = this.edgeDirection(current.id, this.otherEnd(current.id, nodeId));
      const straight = options.find((edge) => {
        const dir = this.edgeDirection(edge, nodeId);
        return dir.dx === inbound.dx && dir.dz === inbound.dz;
      });
      if (straight !== undefined && random() < 0.62) return straight;
    }
    return options[Math.floor(random() * options.length)];
  }

  /**
   * Traffic light state for a node + axis.
   * `phase` cycles every `cycle` seconds; x-axis gets green on even phases.
   */
  isGreen(nodeId: number, axis: 'x' | 'z', time: number): boolean {
    return this.signalState(nodeId, axis, time) !== 'red';
  }

  /** Full signal state including the amber transition. */
  signalState(nodeId: number, axis: 'x' | 'z', time: number): 'green' | 'yellow' | 'red' {
    const node = this.nodes[nodeId];
    const cycle = node.cycleLength;
    const t = (time + node.signalOffset * 1.7) % (cycle * 2);
    const inFirstHalf = t < cycle;
    const isX = axis === 'x';
    const green = isX ? inFirstHalf : !inFirstHalf;
    if (!green) return 'red';
    const sinceStart = isX ? t : t - cycle;
    return sinceStart > cycle - 2.4 ? 'yellow' : 'green';
  }

  /** Seconds until the given axis turns green (used for AI patience). */
  secondsUntilGreen(nodeId: number, axis: 'x' | 'z', time: number): number {
    const node = this.nodes[nodeId];
    const cycle = node.cycleLength;
    const t = time + node.signalOffset * 1.7;
    const phase = Math.floor(t / cycle) % 2;
    const wantGreen = axis === 'x' ? 0 : 1;
    if (phase === wantGreen) return 0;
    return cycle - (t % cycle);
  }

  /** True when the position is on a road (used for spawn sanity). */
  isOnRoad(x: number, z: number): boolean {
    const fx = Math.abs(((x + HALF_X) % CELL) - CELL / 2);
    const fz = Math.abs(((z + HALF_Z) % CELL) - CELL / 2);
    return fx > BLOCK_SIZE / 2 || fz > BLOCK_SIZE / 2;
  }
}
