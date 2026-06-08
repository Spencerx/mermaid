import {
  orthogonalizePolyline,
  pointInsideRect,
  rectOfNodeBounds,
  samePoint,
  sameX,
  sameY,
  simplifyPolyline,
} from './geometry.js';
import type { Point, RectBounds } from './geometry.js';

const EPS = 1e-3;
const INSIDE_EPS = 0.5;
const CORNER_CLEARANCE = 4;

type NodeRect = RectBounds;

type BorderSide = 'top' | 'bottom' | 'left' | 'right';

interface EndpointEdge {
  isLayoutOnly?: boolean;
  points?: Point[];
  start?: string;
  end?: string;
}

function endpointContextFor(edge: unknown, nodeByIdMap: Map<string, any>, minPoints: number) {
  const candidate = edge as EndpointEdge;
  if (candidate.isLayoutOnly || !candidate.points || candidate.points.length < minPoints) {
    return undefined;
  }
  const src = candidate.start ? nodeByIdMap.get(candidate.start) : undefined;
  const dst = candidate.end ? nodeByIdMap.get(candidate.end) : undefined;
  return {
    edge: candidate,
    points: candidate.points,
    srcRect: src ? rectOfNodeBounds(src) : undefined,
    dstRect: dst ? rectOfNodeBounds(dst) : undefined,
  };
}

// Given an axis-aligned segment from outside a rect to inside it, return the
// point where the segment enters the rect boundary.
function segmentEnterPoint(outside: Point, inside: Point, r: NodeRect): Point {
  if (sameY(outside, inside, EPS)) {
    const x = outside.x < r.left ? r.left : r.right;
    return { x, y: outside.y };
  }
  if (sameX(outside, inside, EPS)) {
    const y = outside.y < r.top ? r.top : r.bottom;
    return { x: outside.x, y };
  }
  return {
    x: Math.min(r.right, Math.max(r.left, outside.x)),
    y: Math.min(r.bottom, Math.max(r.top, outside.y)),
  };
}

function clipEndpoint(points: Point[], rect: NodeRect, atStart: boolean): Point[] {
  const step = atStart ? 1 : -1;
  let outsideIndex = atStart ? 0 : points.length - 1;
  while (
    outsideIndex >= 0 &&
    outsideIndex < points.length &&
    pointInsideRect(points[outsideIndex], rect, INSIDE_EPS)
  ) {
    outsideIndex += step;
  }
  if (outsideIndex < 0 || outsideIndex >= points.length) {
    return points;
  }

  const insideIndex = outsideIndex - step;
  if (insideIndex < 0 || insideIndex >= points.length) {
    return points;
  }

  const entry = segmentEnterPoint(points[outsideIndex], points[insideIndex], rect);
  return atStart
    ? [entry, ...points.slice(outsideIndex)]
    : [...points.slice(0, outsideIndex + 1), entry];
}

export function clipEdgeEndpointsToNodeBoundaries(edges: unknown[], nodeByIdMap: Map<string, any>) {
  for (const edge of edges) {
    const context = endpointContextFor(edge, nodeByIdMap, 2);
    if (!context) {
      continue;
    }

    let next = [...context.points];
    if (context.srcRect) {
      next = clipEndpoint(next, context.srcRect, true);
    }
    if (context.dstRect) {
      next = clipEndpoint(next, context.dstRect, false);
    }
    next = simplifyPolyline(orthogonalizePolyline(next));
    next = clearStraightEndpointCornerConnections(next, context.srcRect, context.dstRect);
    context.edge.points = simplifyPolyline(orthogonalizePolyline(next));
  }
}

function snapEndpointToBoundary(
  inner: Point,
  endpoint: Point,
  r: NodeRect,
  useApproachSide = false
): Point {
  if (sameY(inner, endpoint, EPS)) {
    if (endpoint.y < r.top - EPS || endpoint.y > r.bottom + EPS) {
      return endpoint;
    }
    if (useApproachSide) {
      if (inner.x < r.left - EPS) {
        return { x: r.left, y: inner.y };
      }
      if (inner.x > r.right + EPS) {
        return { x: r.right, y: inner.y };
      }
    }
    const toLeft = Math.abs(endpoint.x - r.left) <= Math.abs(endpoint.x - r.right);
    return { x: toLeft ? r.left : r.right, y: inner.y };
  }
  if (sameX(inner, endpoint, EPS)) {
    if (endpoint.x < r.left - EPS || endpoint.x > r.right + EPS) {
      return endpoint;
    }
    if (useApproachSide) {
      if (inner.y < r.top - EPS) {
        return { x: inner.x, y: r.top };
      }
      if (inner.y > r.bottom + EPS) {
        return { x: inner.x, y: r.bottom };
      }
    }
    const toTop = Math.abs(endpoint.y - r.top) <= Math.abs(endpoint.y - r.bottom);
    return { x: inner.x, y: toTop ? r.top : r.bottom };
  }
  return endpoint;
}

function firstDistinctAdjacent(
  points: Point[],
  endpointIndex: number,
  step: 1 | -1
): Point | undefined {
  const endpoint = points[endpointIndex];
  for (let index = endpointIndex + step; index >= 0 && index < points.length; index += step) {
    const candidate = points[index];
    if (!samePoint(candidate, endpoint, EPS)) {
      return candidate;
    }
  }
  return points[endpointIndex + step];
}

function cornerClearanceRange(min: number, max: number): { lo: number; hi: number } {
  const lo = min + CORNER_CLEARANCE;
  const hi = max - CORNER_CLEARANCE;
  return lo <= hi ? { lo, hi } : { lo: (min + max) / 2, hi: (min + max) / 2 };
}

function clampToCornerClearance(value: number, min: number, max: number): number {
  const { lo, hi } = cornerClearanceRange(min, max);
  return Math.min(hi, Math.max(lo, value));
}

function intersectRanges(
  ranges: { lo: number; hi: number }[]
): { lo: number; hi: number } | undefined {
  const lo = Math.max(...ranges.map((range) => range.lo));
  const hi = Math.min(...ranges.map((range) => range.hi));
  if (lo > hi) {
    return undefined;
  }
  return { lo, hi };
}

function clearanceRangeForSide(r: NodeRect, side: BorderSide): { lo: number; hi: number } {
  return side === 'left' || side === 'right'
    ? cornerClearanceRange(r.top, r.bottom)
    : cornerClearanceRange(r.left, r.right);
}

function terminalSideForSegment(
  endpoint: Point,
  adjacent: Point,
  r: NodeRect
): BorderSide | undefined {
  const yWithin = endpoint.y >= r.top - EPS && endpoint.y <= r.bottom + EPS;
  const xWithin = endpoint.x >= r.left - EPS && endpoint.x <= r.right + EPS;
  if (sameY(endpoint, adjacent, EPS) && yWithin) {
    if (Math.abs(endpoint.x - r.left) < EPS) {
      return 'left';
    }
    if (Math.abs(endpoint.x - r.right) < EPS) {
      return 'right';
    }
  }
  if (sameX(endpoint, adjacent, EPS) && xWithin) {
    if (Math.abs(endpoint.y - r.top) < EPS) {
      return 'top';
    }
    if (Math.abs(endpoint.y - r.bottom) < EPS) {
      return 'bottom';
    }
  }
  return undefined;
}

function clearStraightEndpointCornerConnections(
  points: Point[],
  srcRect?: NodeRect,
  dstRect?: NodeRect
): Point[] {
  if (points.length !== 2) {
    return points;
  }

  const [start, end] = points;
  if (sameY(start, end, EPS)) {
    const ranges: { lo: number; hi: number }[] = [];
    const srcSide = srcRect ? terminalSideForSegment(start, end, srcRect) : undefined;
    const dstSide = dstRect ? terminalSideForSegment(end, start, dstRect) : undefined;
    if (srcRect && srcSide && (srcSide === 'left' || srcSide === 'right')) {
      ranges.push(clearanceRangeForSide(srcRect, srcSide));
    }
    if (dstRect && dstSide && (dstSide === 'left' || dstSide === 'right')) {
      ranges.push(clearanceRangeForSide(dstRect, dstSide));
    }
    const range = ranges.length > 0 ? intersectRanges(ranges) : undefined;
    if (!range) {
      return points;
    }
    const y = Math.min(range.hi, Math.max(range.lo, start.y));
    if (Math.abs(y - start.y) < EPS) {
      return points;
    }
    return [
      { x: start.x, y },
      { x: end.x, y },
    ];
  }

  if (sameX(start, end, EPS)) {
    const ranges: { lo: number; hi: number }[] = [];
    const srcSide = srcRect ? terminalSideForSegment(start, end, srcRect) : undefined;
    const dstSide = dstRect ? terminalSideForSegment(end, start, dstRect) : undefined;
    if (srcRect && srcSide && (srcSide === 'top' || srcSide === 'bottom')) {
      ranges.push(clearanceRangeForSide(srcRect, srcSide));
    }
    if (dstRect && dstSide && (dstSide === 'top' || dstSide === 'bottom')) {
      ranges.push(clearanceRangeForSide(dstRect, dstSide));
    }
    const range = ranges.length > 0 ? intersectRanges(ranges) : undefined;
    if (!range) {
      return points;
    }
    const x = Math.min(range.hi, Math.max(range.lo, start.x));
    if (Math.abs(x - start.x) < EPS) {
      return points;
    }
    return [
      { x, y: start.y },
      { x, y: end.y },
    ];
  }

  return points;
}

function clearEndpointCornerConnection(points: Point[], r: NodeRect, atStart: boolean): Point[] {
  if (points.length < 2) {
    return points;
  }

  const endpointIndex = atStart ? 0 : points.length - 1;
  const step = atStart ? 1 : -1;
  const endpoint = points[endpointIndex];
  const adjacent = firstDistinctAdjacent(points, endpointIndex, step);
  if (!adjacent) {
    return points;
  }

  const side = terminalSideForSegment(endpoint, adjacent, r);
  if (!side) {
    return points;
  }

  const horizontalTerminal = side === 'left' || side === 'right';
  const adjusted = horizontalTerminal
    ? { x: endpoint.x, y: clampToCornerClearance(endpoint.y, r.top, r.bottom) }
    : { x: clampToCornerClearance(endpoint.x, r.left, r.right), y: endpoint.y };
  if (samePoint(endpoint, adjusted, EPS)) {
    return points;
  }

  const next = points.map((point) => ({ ...point }));
  for (let index = endpointIndex; index >= 0 && index < points.length; index += step) {
    const point = points[index];
    if (horizontalTerminal) {
      if (!sameY(point, endpoint, EPS)) {
        break;
      }
      next[index].y = adjusted.y;
    } else {
      if (!sameX(point, endpoint, EPS)) {
        break;
      }
      next[index].x = adjusted.x;
    }
  }
  return next;
}

function borderSideForSegment(a: Point, b: Point, r: NodeRect): BorderSide | undefined {
  const xWithin = Math.min(a.x, b.x) >= r.left - EPS && Math.max(a.x, b.x) <= r.right + EPS;
  const yWithin = Math.min(a.y, b.y) >= r.top - EPS && Math.max(a.y, b.y) <= r.bottom + EPS;
  if (Math.abs(a.y - r.top) < EPS && Math.abs(b.y - r.top) < EPS && xWithin) {
    return 'top';
  }
  if (Math.abs(a.y - r.bottom) < EPS && Math.abs(b.y - r.bottom) < EPS && xWithin) {
    return 'bottom';
  }
  if (Math.abs(a.x - r.left) < EPS && Math.abs(b.x - r.left) < EPS && yWithin) {
    return 'left';
  }
  if (Math.abs(a.x - r.right) < EPS && Math.abs(b.x - r.right) < EPS && yWithin) {
    return 'right';
  }
  return undefined;
}

function leavesOutward(side: BorderSide, from: Point, to: Point, r: NodeRect): boolean {
  switch (side) {
    case 'top':
      return sameX(from, to, EPS) && to.y < r.top - EPS;
    case 'bottom':
      return sameX(from, to, EPS) && to.y > r.bottom + EPS;
    case 'left':
      return sameY(from, to, EPS) && to.x < r.left - EPS;
    case 'right':
      return sameY(from, to, EPS) && to.x > r.right + EPS;
  }
}

function collapseOwnBorderStub(points: Point[], r: NodeRect, atStart: boolean): Point[] {
  if (points.length < 3) {
    return points;
  }
  if (atStart) {
    const side = borderSideForSegment(points[0], points[1], r);
    if (side && leavesOutward(side, points[1], points[2], r)) {
      return points.slice(1);
    }
    return points;
  }

  const last = points.length - 1;
  const side = borderSideForSegment(points[last - 1], points[last], r);
  if (side && leavesOutward(side, points[last - 1], points[last - 2], r)) {
    return points.slice(0, last);
  }
  return points;
}

function snapAndCollapseEndpoints(
  points: Point[],
  srcRect?: NodeRect,
  dstRect?: NodeRect
): Point[] {
  let next = points;
  if (srcRect) {
    const adjacent = firstDistinctAdjacent(next, 0, 1);
    if (adjacent) {
      const snapped = snapEndpointToBoundary(adjacent, next[0], srcRect);
      if (snapped !== next[0]) {
        next = [snapped, ...next.slice(1)];
      }
    }
    next = collapseOwnBorderStub(next, srcRect, true);
  }
  if (dstRect) {
    const last = next.length - 1;
    const adjacent = firstDistinctAdjacent(next, last, -1);
    if (adjacent) {
      const snapped = snapEndpointToBoundary(adjacent, next[last], dstRect, true);
      if (snapped !== next[last]) {
        next = [...next.slice(0, last), snapped];
      }
    }
    next = collapseOwnBorderStub(next, dstRect, false);
  }

  const straightCleared = clearStraightEndpointCornerConnections(next, srcRect, dstRect);
  if (straightCleared !== next || next.length === 2) {
    return straightCleared;
  }

  if (srcRect) {
    next = clearEndpointCornerConnection(next, srcRect, true);
  }
  if (dstRect) {
    next = clearEndpointCornerConnection(next, dstRect, false);
  }
  return next;
}

export function prepareEdgeEndpointsForRenderer(edges: unknown[], nodeByIdMap: Map<string, any>) {
  for (const edge of edges) {
    const context = endpointContextFor(edge, nodeByIdMap, 2);
    if (!context) {
      continue;
    }

    const newPts = snapAndCollapseEndpoints(context.points, context.srcRect, context.dstRect);
    if (newPts.length < 3) {
      context.edge.points = newPts;
      continue;
    }
    const duplicated = [
      newPts[0],
      { ...newPts[0] },
      ...newPts.slice(1, -1),
      newPts[newPts.length - 1],
      { ...newPts[newPts.length - 1] },
    ];
    context.edge.points = duplicated;
  }
}
