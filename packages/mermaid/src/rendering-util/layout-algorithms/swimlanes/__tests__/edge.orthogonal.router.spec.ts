import { describe, it, expect } from 'vitest';
import { routeEdgesOrthogonal } from '../edgeOrthogonalRouter.js';
import type { LayoutData } from '../../../types.js';

// Simple rectangle boundary intersection for tests
interface Point {
  x: number;
  y: number;
}

interface RectNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectIntersect(node: RectNode, outside: Point): Point | null {
  const cx = node.x;
  const cy = node.y;
  const hw = node.width / 2;
  const hh = node.height / 2;
  const dx = outside.x - cx;
  const dy = outside.y - cy;
  if (dx === 0 && dy === 0) {
    return null;
  }
  const sx = hw > 0 ? Math.abs(dx) / hw : Infinity;
  const sy = hh > 0 ? Math.abs(dy) / hh : Infinity;
  const m = Math.max(sx, sy);
  if (!Number.isFinite(m) || m === 0) {
    return null;
  }
  return { x: cx + dx / m, y: cy + dy / m };
}

// Build minimal LayoutData for router tests (we don't need full pipeline)
interface TestNode extends RectNode {
  id: string;
  isGroup: boolean;
  parentId?: string;
  intersect?: (p: Point) => Point | null;
}

interface TestEdge {
  id: string;
  start: string;
  end: string;
  type: 'normal';
  points?: Point[];
}

interface TestLayout {
  nodes: TestNode[];
  edges: TestEdge[];
  config: Record<string, unknown>;
}

function mkNode(id: string, x: number, y: number, opts?: Partial<TestNode>): TestNode {
  const base: TestNode = {
    id,
    isGroup: false,
    x,
    y,
    width: 100,
    height: 80,
    intersect: (p: Point) => rectIntersect({ x, y, width: 100, height: 80 }, p),
  };
  return { ...base, ...opts };
}

function mkLane(id: string, x: number, y: number, width: number, height: number): TestNode {
  return { id, isGroup: true, x, y, width, height };
}

function mkEdge(id: string, start: string, end: string): TestEdge {
  return { id, start, end, type: 'normal' };
}

describe('Orthogonal router — lane/corridor aware', () => {
  it('flowchart TD sample with realistic positions (aligned Y) prefers straight across lanes', () => {
    // Test that when a single edge crosses lanes with aligned Y, it uses a straight line
    const lane1 = mkLane('lane1', 250, 150, 400, 220); // left lane: [50,450]
    const lane2 = mkLane('lane2', 700, 150, 220, 220); // right lane: [590,810]

    const D = mkNode('D', 360, 150, { parentId: 'lane1' }); // right inside lane1
    const C = mkNode('C', 700, 150, { parentId: 'lane2' }); // center of lane2

    const e1 = mkEdge('e1', 'C', 'D');

    const layout: TestLayout = { nodes: [lane1, lane2, D, C], edges: [e1], config: {} };

    routeEdgesOrthogonal(layout as LayoutData);

    // Single edge should be straight horizontal (router prefers straight when Y aligned and unblocked)
    const e = layout.edges[0];
    const points = e.points;
    expect(points, `edge ${e.id} has points`).toBeTruthy();
    expect(Array.isArray(points)).toBe(true);
    if (!points) {
      return;
    }
    expect(points.length).toBe(2);
    const [p0, p1] = points;
    expect(p0.y).toBeCloseTo(p1.y, 6);
    // Should cross from lane2 towards lane1 (right->left)
    expect(p0.x).toBeGreaterThan(p1.x);
    // Ensure the segment crosses the inter-lane corridor region between lane1.right and lane2.left
    const lane1Right = lane1.x + lane1.width / 2; // 450
    const lane2Left = lane2.x - lane2.width / 2; // 590
    const minX = Math.min(p0.x, p1.x);
    const maxX = Math.max(p0.x, p1.x);
    expect(minX).toBeLessThan(lane2Left + 1);
    expect(maxX).toBeGreaterThan(lane1Right - 1);
  });

  it('when Y not aligned, cross-lane edges route via corridor between lanes', () => {
    const lane1 = mkLane('lane1', 250, 150, 400, 220);
    const lane2 = mkLane('lane2', 700, 150, 220, 220);

    const A = mkNode('A', 120, 110, { parentId: 'lane1' }); // slightly above
    const D = mkNode('D', 360, 190, { parentId: 'lane1' }); // slightly below
    const C = mkNode('C', 700, 150, { parentId: 'lane2' });

    const e1 = mkEdge('e1', 'C', 'D');
    const e2 = mkEdge('e2', 'C', 'A');

    const layout: TestLayout = { nodes: [lane1, lane2, A, D, C], edges: [e1, e2], config: {} };

    routeEdgesOrthogonal(layout as LayoutData);

    for (const e of layout.edges) {
      const pts = e.points;
      expect(pts, `edge ${e.id} has points`).toBeTruthy();
      expect(Array.isArray(pts)).toBe(true);
      if (!pts) {
        continue;
      }
      // Expect orthogonal polyline with at least one corridor vertical segment
      expect(pts.length).toBeGreaterThanOrEqual(4);
      const lane1Right = lane1.x + lane1.width / 2; // 450
      const lane2Left = lane2.x - lane2.width / 2; // 590
      // There must exist a vertical segment within the corridor (between lanes)
      const hasVerticalInCorridor = pts.some((p: Point, i: number) => {
        const q = pts[i + 1];
        if (!q) {
          return false;
        }
        const isVertical = Math.abs(p.x - q.x) < 1e-6;
        const inCorridor = p.x > lane1Right - 1 && p.x < lane2Left + 1;
        return isVertical && inCorridor;
      });
      expect(hasVerticalInCorridor).toBe(true);
      // Also ensure at least one horizontal segment exists overall
      const hasHorizontal = pts.some((p: Point, i: number) => {
        const q = pts[i + 1];
        if (!q) {
          return false;
        }
        return Math.abs(p.y - q.y) < 1e-6;
      });
      expect(hasHorizontal).toBe(true);
    }
  });
  it('uses rectangle intersection for nodes without intersect so edges hit boundaries', () => {
    const A = mkNode('A', 100, 200, { intersect: undefined });
    const B = mkNode('B', 400, 200, { intersect: undefined });

    const e1 = mkEdge('e1', 'A', 'B');

    const layout: TestLayout = { nodes: [A, B], edges: [e1], config: {} };

    routeEdgesOrthogonal(layout as LayoutData);

    const pts = layout.edges[0].points;
    expect(pts, 'edge e1 has points').toBeTruthy();
    expect(Array.isArray(pts)).toBe(true);
    if (!pts) {
      return;
    }
    expect(pts.length).toBe(2);
    const [p0, p1] = pts;

    const aHalfWidth = A.width / 2;
    // Horizontal edge from A to B should start at right side of A and end at left side of B
    expect(p0.y).toBeCloseTo(A.y, 6);
    expect(p1.y).toBeCloseTo(B.y, 6);
    expect(p0.x).toBeCloseTo(A.x + aHalfWidth, 6);
    expect(p1.x).toBeCloseTo(B.x - aHalfWidth, 6);
  });
});
