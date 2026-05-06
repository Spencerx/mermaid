const EPS = 1e-3;

interface Point {
  x: number;
  y: number;
}

interface SimplifyPassResult {
  points: Point[];
  changed: boolean;
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}

function sameX(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPS;
}

function sameY(a: Point, b: Point): boolean {
  return Math.abs(a.y - b.y) < EPS;
}

function strictlyBetween(value: number, a: number, b: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return value > lo + EPS && value < hi - EPS;
}

function isCollinearIntermediate(prev: Point, cur: Point, next: Point): boolean {
  if (sameX(prev, cur) && sameX(cur, next)) {
    return strictlyBetween(cur.y, prev.y, next.y);
  }

  if (sameY(prev, cur) && sameY(cur, next)) {
    return strictlyBetween(cur.x, prev.x, next.x);
  }

  return false;
}

function simplifyPolylineOnce(points: Point[]): SimplifyPassResult {
  let changed = false;
  const out: Point[] = [];

  for (let i = 0; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    const next = i + 1 < points.length ? points[i + 1] : undefined;
    if (prev && next) {
      if (samePoint(prev, next)) {
        i++;
        changed = true;
        continue;
      }

      if (isCollinearIntermediate(prev, cur, next)) {
        changed = true;
        continue;
      }
    }
    out.push(cur);
  }

  return { points: out, changed };
}

// Inserts orthogonal L-bends and removes consecutive duplicate points.
export function orthogonalizePolyline(pts: Point[]): Point[] {
  const cleaned: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    const curr = pts[i];
    if (!sameX(prev, curr) && !sameY(prev, curr)) {
      const prevPrev = cleaned.length >= 2 ? cleaned[cleaned.length - 2] : undefined;
      const incomingVertical = prevPrev ? sameX(prevPrev, prev) : false;
      const corner = incomingVertical ? { x: prev.x, y: curr.y } : { x: curr.x, y: prev.y };
      cleaned.push(corner);
    }
    cleaned.push(curr);
  }
  const deduped: Point[] = [];
  for (const p of cleaned) {
    const last = deduped[deduped.length - 1];
    if (!last || !samePoint(last, p)) {
      deduped.push(p);
    }
  }
  return deduped;
}

export function simplifyPolyline(pts: Point[]): Point[] {
  if (pts.length < 3) {
    return pts;
  }
  let work = [...pts];
  for (let guard = 0; guard < 32; guard++) {
    const result = simplifyPolylineOnce(work);
    work = result.points;
    if (!result.changed) {
      break;
    }
  }
  return work;
}
