import type { LayoutData, Node as MermaidNode } from '../../types.js';
import { PRECISION, EDGE_ROUTING, PATHFINDING } from './config.js';
// cspell:ignore dedup

const EPS = PRECISION.EPSILON;
const LANE_MARGIN = EDGE_ROUTING.LANE_MARGIN;

/**
 * Orthogonal (Manhattan) edge router with lane/corridor awareness.
 *
 * Mutates and returns the provided LayoutData.
 *
 * Strategy:
 * - If edge.points already exists (from upstream layout), preserve it.
 * - Prefer straight horizontal/vertical when aligned.
 * - For cross-lane edges, route via a corridor between lane boundaries.
 * - For same-lane edges, use an internal rail just outside the lane boundary on the nearer side.
 * - Uses node.intersect(point) when available to find boundary points; otherwise falls back to a
 *   rectangle intersection based on node width/height.
 */
export function routeEdgesOrthogonal(data: LayoutData): LayoutData {
  const nodes = data.nodes ?? [];
  const edges = data.edges ?? [];
  const byId = new Map<string, MermaidNode>();
  for (const n of nodes) {
    byId.set(n.id, n);
  }

  // Collect top-level lane(group) nodes for bounds and centers
  const laneById = new Map<string, MermaidNode>();
  for (const n of nodes) {
    if (n.isGroup && !n.parentId) {
      laneById.set(n.id, n);
    }
  }

  const laneLeft = (laneId: string | null): number => {
    if (!laneId) {
      return 0;
    }
    const L = laneById.get(laneId);
    if (!L) {
      return 0;
    }
    const cx = L.x ?? 0;
    const w = L.width ?? 0;
    return cx - w / 2;
  };
  const laneRight = (laneId: string | null): number => {
    if (!laneId) {
      return 0;
    }
    const L = laneById.get(laneId);
    if (!L) {
      return 0;
    }
    const cx = L.x ?? 0;
    const w = L.width ?? 0;
    return cx + w / 2;
  };
  const laneCenter = (laneId: string | null): number => {
    if (!laneId) {
      return 0;
    }
    const L = laneById.get(laneId);
    if (!L || typeof L.x !== 'number') {
      return 0;
    }
    return L.x;
  };

  const topLaneOf = (id: string | undefined | null): string | null => {
    if (!id) {
      return null;
    }
    const cur = byId.get(id);
    if (!cur) {
      return null;
    }
    let pid: string | undefined = cur.parentId;
    if (!pid) {
      return null;
    }
    let parent = byId.get(pid);
    while (parent?.parentId) {
      pid = parent.parentId;
      parent = pid ? byId.get(pid) : undefined;
    }
    return pid ?? null;
  };

  const getIntersection = (
    node: MermaidNode,
    toward: { x: number; y: number }
  ): { x: number; y: number } | null => {
    const cx = node.x ?? 0;
    const cy = node.y ?? 0;

    // Prefer shape-specific intersect when available (e.g. ELK/dagre shapes)
    const nodeWithIntersect = node as MermaidNode & {
      intersect?: (point: { x: number; y: number }) => { x: number; y: number } | null;
    };
    if (typeof nodeWithIntersect.intersect === 'function') {
      const res = nodeWithIntersect.intersect(toward);
      if (res) {
        const distFromCenter = Math.hypot(cx - res.x, cy - res.y);
        if (distFromCenter > EPS) {
          return res;
        }
      }
    }

    // Fallback: compute intersection of the ray from node center to `toward`
    // with the node's axis-aligned bounding box. This mirrors the rectangle
    // logic used in the Hola layout so that edges touch node boundaries even
    // when `node.intersect` is not present.
    const w = node.width ?? 0;
    const h = node.height ?? 0;
    const hw = w / 2;
    const hh = h / 2;
    const dx = toward.x - cx;
    const dy = toward.y - cy;

    if ((dx === 0 && dy === 0) || hw <= 0 || hh <= 0) {
      return null;
    }

    const sx = hw > 0 ? Math.abs(dx) / hw : Infinity;
    const sy = hh > 0 ? Math.abs(dy) / hh : Infinity;
    const m = Math.max(sx, sy);
    if (!Number.isFinite(m) || m === 0) {
      return null;
    }

    const ix = cx + dx / m;
    const iy = cy + dy / m;
    const dist = Math.hypot(ix - cx, iy - cy);
    if (dist <= EPS) {
      return null;
    }

    return { x: ix, y: iy };
  };

  // Build obstacle rectangles (non-group nodes) for straight-line blocking checks
  interface Rect {
    left: number;
    right: number;
    top: number;
    bottom: number;
    id: string;
  }
  const obstacles: Rect[] = [];
  for (const n of nodes) {
    if (n.isGroup) {
      continue;
    }
    const cx = n.x ?? 0;
    const cy = n.y ?? 0;
    const w = n.width ?? 0;
    const h = n.height ?? 0;
    obstacles.push({
      id: n.id,
      left: cx - w / 2,
      right: cx + w / 2,
      top: cy - h / 2,
      bottom: cy + h / 2,
    });
  }

  const segBlockedHorizontal = (y: number, x1: number, x2: number, sId: string, tId: string) => {
    const a = Math.min(x1, x2);
    const b = Math.max(x1, x2);
    for (const r of obstacles) {
      if (r.id === sId || r.id === tId) {
        continue;
      }
      if (y > r.top - EPS && y < r.bottom + EPS) {
        const lo = Math.max(a, r.left);
        const hi = Math.min(b, r.right);
        if (hi - lo > EPS) {
          return true;
        }
      }
    }
    return false;
  };
  const segBlockedVertical = (x: number, y1: number, y2: number, sId: string, tId: string) => {
    const a = Math.min(y1, y2);
    const b = Math.max(y1, y2);
    for (const r of obstacles) {
      if (r.id === sId || r.id === tId) {
        continue;
      }
      if (x > r.left - EPS && x < r.right + EPS) {
        const lo = Math.max(a, r.top);
        const hi = Math.min(b, r.bottom);
        if (hi - lo > EPS) {
          return true;
        }
      }
    }
    return false;
  };

  // Simple track reservation to avoid overlapping edges on the same rail/corridor
  const EDGE_GAP = EDGE_ROUTING.EDGE_GAP;
  interface Interval {
    a: number;
    b: number;
  }
  const horizRes = new Map<string, Interval[]>(); // key = y rounded
  const vertRes = new Map<string, Interval[]>(); // key = x rounded

  const keyY = (y: number) => y.toFixed(1);
  const keyX = (x: number) => x.toFixed(1);
  const sKeyY = (y: number) => y.toFixed(3);
  const sKeyX = (x: number) => x.toFixed(3);

  const overlaps = (a1: number, a2: number, b1: number, b2: number) => {
    const lo = Math.max(Math.min(a1, a2), Math.min(b1, b2));
    const hi = Math.min(Math.max(a1, a2), Math.max(b1, b2));
    return hi - lo > EPS;
  };

  const canReserveHorizontal = (y: number, x1: number, x2: number) => {
    const list = horizRes.get(keyY(y));
    if (!list) {
      return true;
    }
    return !list.some((iv) => overlaps(iv.a, iv.b, x1, x2));
  };
  const reserveHorizontal = (y: number, x1: number, x2: number) => {
    const k = keyY(y);
    const list = horizRes.get(k) ?? [];
    list.push({ a: Math.min(x1, x2), b: Math.max(x1, x2) });
    horizRes.set(k, list);
  };

  const canReserveVertical = (x: number, y1: number, y2: number) => {
    const list = vertRes.get(keyX(x));
    if (!list) {
      return true;
    }
    return !list.some((iv) => overlaps(iv.a, iv.b, y1, y2));
  };
  const reserveVertical = (x: number, y1: number, y2: number) => {
    const k = keyX(x);
    const list = vertRes.get(k) ?? [];
    list.push({ a: Math.min(y1, y2), b: Math.max(y1, y2) });
    vertRes.set(k, list);
  };

  // Choose a Y-offset (multiples of EDGE_GAP) for a horizontal segment [x1,x2] near yBase
  const chooseHTrackOffset = (yBase: number, x1: number, x2: number): number => {
    const seq: number[] = [0];
    for (let k = 1; k <= EDGE_ROUTING.MAX_TRACK_SEARCH; k++) {
      seq.push(k, -k);
    }
    for (const k of seq) {
      const y = yBase + k * EDGE_GAP;
      if (canReserveHorizontal(y, x1, x2)) {
        reserveHorizontal(y, x1, x2);
        return k * EDGE_GAP;
      }
    }
    // fallback
    const y = yBase + EDGE_ROUTING.FALLBACK_TRACK_OFFSET * EDGE_GAP;
    reserveHorizontal(y, x1, x2);
    return EDGE_ROUTING.FALLBACK_TRACK_OFFSET * EDGE_GAP;
  };

  // Choose an X-offset (multiples of EDGE_GAP) for a vertical segment [y1,y2] near xBase
  const chooseVTrackOffset = (xBase: number, y1: number, y2: number): number => {
    const seq: number[] = [0];
    for (let k = 1; k <= EDGE_ROUTING.MAX_TRACK_SEARCH; k++) {
      seq.push(k, -k);
    }
    for (const k of seq) {
      const x = xBase + k * EDGE_GAP;
      if (canReserveVertical(x, y1, y2)) {
        reserveVertical(x, y1, y2);
        return k * EDGE_GAP;
      }
    }
    const x = xBase + EDGE_ROUTING.FALLBACK_TRACK_OFFSET * EDGE_GAP;
    reserveVertical(x, y1, y2);
    return EDGE_ROUTING.FALLBACK_TRACK_OFFSET * EDGE_GAP;
  };

  interface Pt {
    x: number;
    y: number;
  }
  const simplify = (ptsIn: Pt[], protectX?: Set<string>, protectY?: Set<string>): Pt[] => {
    if (ptsIn.length <= 2) {
      return [...ptsIn];
    }
    // remove consecutive duplicates
    const dedup: Pt[] = [];
    for (const p of ptsIn) {
      const last = dedup[dedup.length - 1];
      if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.y - p.y) > EPS) {
        dedup.push(p);
      }
    }
    if (dedup.length <= 2) {
      return dedup;
    }
    // remove collinear interior points, respecting protected rails
    const out: Pt[] = [dedup[0]];
    for (let i = 1; i < dedup.length - 1; i++) {
      const a = dedup[i - 1];
      const b = dedup[i];
      const c = dedup[i + 1];
      const vertical = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS;
      const horizontal = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS;
      const protectedOnRail = protectX?.has(sKeyX(b.x)) || protectY?.has(sKeyY(b.y));
      if ((vertical || horizontal) && !protectedOnRail) {
        // b lies on the straight segment; drop it
        continue;
      }
      out.push(b);
    }
    out.push(dedup[dedup.length - 1]);
    return out;
  };

  // Grid-based orthogonal pathfinding used when a straight aligned segment is blocked
  const planPathOrtho = (s: Pt, t: Pt, sId: string, tId: string): Pt[] | null => {
    const uniqSorted = (arr: number[]) =>
      [...new Set(arr.map((v) => +v.toFixed(3)))].sort((a, b) => a - b);
    const isClearH = (y: number, x1: number, x2: number) =>
      !segBlockedHorizontal(y, x1, x2, sId, tId);
    const isClearV = (x: number, y1: number, y2: number) =>
      !segBlockedVertical(x, y1, y2, sId, tId);

    const CLEAR = EDGE_ROUTING.CLEARANCE; // clearance margin around obstacles
    const Xs: number[] = [s.x, t.x];
    const Ys: number[] = [s.y, t.y];
    for (const r of obstacles) {
      if (r.id === sId || r.id === tId) {
        continue;
      }
      Xs.push(r.left - CLEAR, r.left, r.right, r.right + CLEAR);
      Ys.push(r.top - CLEAR, r.top, r.bottom, r.bottom + CLEAR);
    }
    const xs = uniqSorted(Xs);
    const ys = uniqSorted(Ys);

    if (Math.abs(s.y - t.y) < EPS && isClearH(s.y, s.x, t.x)) {
      return [s, t];
    }
    if (Math.abs(s.x - t.x) < EPS && isClearV(s.x, s.y, t.y)) {
      return [s, t];
    }

    const xi = new Map<number, number>();
    const yi = new Map<number, number>();
    xs.forEach((v, i) => xi.set(v, i));
    ys.forEach((v, i) => yi.set(v, i));

    const start = { i: xi.get(s.x)!, j: yi.get(s.y)! };
    const goal = { i: xi.get(t.x)!, j: yi.get(t.y)! };

    interface Node {
      i: number;
      j: number;
    }
    const key = (n: Node) => `${n.i},${n.j}`;

    const neighbors = (n: Node): Node[] => {
      const out: Node[] = [];
      const x = xs[n.i];
      const y = ys[n.j];
      if (n.i - 1 >= 0 && isClearH(y, xs[n.i - 1], x)) {
        out.push({ i: n.i - 1, j: n.j });
      }
      if (n.i + 1 < xs.length && isClearH(y, x, xs[n.i + 1])) {
        out.push({ i: n.i + 1, j: n.j });
      }
      if (n.j - 1 >= 0 && isClearV(x, ys[n.j - 1], y)) {
        out.push({ i: n.i, j: n.j - 1 });
      }
      if (n.j + 1 < ys.length && isClearV(x, y, ys[n.j + 1])) {
        out.push({ i: n.i, j: n.j + 1 });
      }
      return out;
    };

    const h = (a: Node, b: Node) => Math.abs(xs[a.i] - xs[b.i]) + Math.abs(ys[a.j] - ys[b.j]);
    const open = new Set<string>();
    const gScore = new Map<string, number>();
    const fScore = new Map<string, number>();
    const came = new Map<string, Node>();

    open.add(key(start));
    gScore.set(key(start), 0);
    fScore.set(key(start), h(start, goal));

    const dirOf = (from: Node | undefined, to: Node | undefined) => {
      if (!from || !to) {
        return 0;
      }
      if (from.i !== to.i) {
        return 1;
      } // horizontal
      if (from.j !== to.j) {
        return 2;
      } // vertical
      return 0;
    };

    while (open.size > 0) {
      let curKey: string | null = null;
      let curNode: Node | null = null;
      let best = Infinity;
      for (const k of open) {
        const fs = fScore.get(k) ?? Infinity;
        if (fs < best) {
          best = fs;
          curKey = k;
          const [iStr, jStr] = k.split(',');
          curNode = { i: +iStr, j: +jStr };
        }
      }
      if (!curNode || !curKey) {
        break;
      }
      if (curNode.i === goal.i && curNode.j === goal.j) {
        const path: Pt[] = [];
        let k = curKey;
        while (k) {
          const [iStr, jStr] = k.split(',');
          path.push({ x: xs[+iStr], y: ys[+jStr] });
          const prev = came.get(k);
          k = prev ? key(prev) : '';
        }
        path.reverse();
        return path;
      }
      open.delete(curKey);

      const curG = gScore.get(curKey) ?? Infinity;
      const curPrev = came.get(curKey);
      const curDir = dirOf(curPrev, curNode);

      for (const nb of neighbors(curNode)) {
        const nbKey = key(nb);
        const moveCost = h(curNode, nb);
        const nbDir = dirOf(curNode, nb);
        const bendPenalty =
          curDir !== 0 && nbDir !== curDir ? EDGE_GAP * PATHFINDING.BEND_PENALTY_FACTOR : 0;
        const tentative = curG + moveCost + bendPenalty;
        if (tentative < (gScore.get(nbKey) ?? Infinity)) {
          came.set(nbKey, curNode);
          gScore.set(nbKey, tentative);
          fScore.set(nbKey, tentative + h(nb, goal));
          open.add(nbKey);
        }
      }
    }
    return null;
  };

  for (const e of edges) {
    // Preserve existing polylines from upstream layout (e.g., mergeDummies)
    if (Array.isArray(e.points) && e.points.length > 0) {
      continue;
    }

    const sId = e.start;
    const tId = e.end;
    if (!sId || !tId) {
      continue;
    }
    const s = byId.get(sId);
    const t = byId.get(tId);
    if (!s || !t) {
      continue;
    }

    const sx = s.x ?? 0;
    const sy = s.y ?? 0;
    const tx = t.x ?? 0;
    const ty = t.y ?? 0;

    // Prefer straight segments when aligned, with node-blocking and track-reservation checks
    if (Math.abs(sy - ty) < EPS) {
      const minX = Math.min(sx, tx);
      const maxX = Math.max(sx, tx);
      const sp0 = getIntersection(s, { x: tx, y: sy }) ?? { x: sx, y: sy };
      const tp0 = getIntersection(t, { x: sx, y: ty }) ?? { x: tx, y: ty };
      const blocked = segBlockedHorizontal(sy, sp0.x, tp0.x, sId, tId);
      if (canReserveHorizontal(sy, minX, maxX) && !blocked) {
        reserveHorizontal(sy, minX, maxX);
        e.points = [sp0, tp0];
      } else {
        const path = planPathOrtho(sp0, tp0, sId, tId);
        if (path && path.length >= 2) {
          e.points = simplify(path);
        } else {
          const y = sy + chooseHTrackOffset(sy, minX, maxX);
          const sp = getIntersection(s, { x: tx, y }) ?? { x: sx, y };
          const tp = getIntersection(t, { x: sx, y }) ?? { x: tx, y };
          e.points = [sp, tp];
        }
      }
      continue;
    }
    if (Math.abs(sx - tx) < EPS) {
      const sp0 = getIntersection(s, { x: sx, y: ty }) ?? { x: sx, y: sy };
      const tp0 = getIntersection(t, { x: tx, y: sy }) ?? { x: tx, y: ty };
      const minY = Math.min(sy, ty);
      const maxY = Math.max(sy, ty);
      const blocked = segBlockedVertical(sx, sp0.y, tp0.y, sId, tId);
      if (canReserveVertical(sx, minY, maxY) && !blocked) {
        reserveVertical(sx, minY, maxY);
        e.points = [sp0, tp0];
      } else {
        const path = planPathOrtho(sp0, tp0, sId, tId);
        if (path && path.length >= 2) {
          e.points = simplify(path);
        } else {
          const x = sx + chooseVTrackOffset(sx, minY, maxY);
          const yOut = sy + chooseHTrackOffset(sy, Math.min(sx, x), Math.max(sx, x));
          const yIn = ty + chooseHTrackOffset(ty, Math.min(x, tx), Math.max(x, tx));
          const sp = getIntersection(s, { x, y: yOut }) ?? { x: sx, y: yOut };
          const tp = getIntersection(t, { x, y: yIn }) ?? { x: tx, y: yIn };
          const protectX = new Set<string>([sKeyX(x)]);
          e.points = simplify([sp, { x, y: yOut }, { x, y: yIn }, tp], protectX);
        }
      }
      continue;
    }

    // Lane/corridor-aware routing
    const sl = topLaneOf(sId);
    const tl = topLaneOf(tId);

    // Cross-lane: route through corridor between lanes
    if (sl && tl && sl !== tl) {
      const sCenter = laneCenter(sl);
      const tCenter = laneCenter(tl);
      const leftLane = sCenter <= tCenter ? sl : tl;
      const rightLane = sCenter <= tCenter ? tl : sl;
      const corrX = (laneRight(leftLane) + laneLeft(rightLane)) / 2;

      const exitX = sx <= corrX ? laneRight(sl) + LANE_MARGIN / 2 : laneLeft(sl) - LANE_MARGIN / 2;
      const enterX = tx >= corrX ? laneLeft(tl) - LANE_MARGIN / 2 : laneRight(tl) + LANE_MARGIN / 2;

      // choose horizontal bands near source/target to avoid overlaps
      const yOut = sy + chooseHTrackOffset(sy, Math.min(sx, exitX), Math.max(sx, exitX));
      const yIn = ty + chooseHTrackOffset(ty, Math.min(enterX, tx), Math.max(enterX, tx));

      // choose vertical corridor rail with offset
      const corrXOff = chooseVTrackOffset(corrX, Math.min(yOut, yIn), Math.max(yOut, yIn));
      const cx = corrX + corrXOff;

      // reserve the inner horizontal runs on the chosen bands
      reserveHorizontal(yOut, Math.min(exitX, cx), Math.max(exitX, cx));
      reserveHorizontal(yIn, Math.min(cx, enterX), Math.max(cx, enterX));

      const sp = getIntersection(s, { x: exitX, y: yOut }) ?? { x: sx, y: yOut };
      const tp = getIntersection(t, { x: enterX, y: yIn }) ?? { x: tx, y: yIn };

      const pts = [
        sp,
        { x: exitX, y: yOut },
        { x: cx, y: yOut },
        { x: cx, y: yIn },
        { x: enterX, y: yIn },
        tp,
      ];
      const protectX = new Set<string>([sKeyX(cx)]);
      e.points = simplify(pts, protectX);
      continue;
    }

    // Same-lane or no-lane: use an internal side rail with vertical track offset
    const goRight = tx >= sx;
    const baseX = goRight ? laneRight(sl) + LANE_MARGIN / 2 : laneLeft(sl) - LANE_MARGIN / 2;
    const cx = baseX + chooseVTrackOffset(baseX, Math.min(sy, ty), Math.max(sy, ty));

    const yOut = sy + chooseHTrackOffset(sy, Math.min(sx, cx), Math.max(sx, cx));
    const yIn = ty + chooseHTrackOffset(ty, Math.min(cx, tx), Math.max(cx, tx));

    const sp = getIntersection(s, { x: cx, y: yOut }) ?? { x: sx, y: yOut };
    const tp = getIntersection(t, { x: cx, y: yIn }) ?? { x: tx, y: yIn };

    const pts = [sp, { x: cx, y: yOut }, { x: cx, y: yIn }, tp];
    const protectX = new Set<string>([sKeyX(cx)]);
    e.points = simplify(pts, protectX);
  }

  return data;
}
