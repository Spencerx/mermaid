import type { LayoutData, Node as MermaidNode } from '../../types.js';
import { PRECISION } from './config.js';

const EPS = PRECISION.EPSILON;

/**
 * Edge routing v1: straight lines between node boundary intersection points.
 * Takes a LayoutData whose nodes already have x/y set and returns the same LayoutData
 * with each edge.points set to two points: [startBoundary, endBoundary].
 */
export function routeEdgesStraight(data: LayoutData): LayoutData {
  const nodes = data.nodes ?? [];
  const edges = data.edges ?? [];
  const byId = new Map<string, MermaidNode>();
  for (const n of nodes) {
    byId.set(n.id, n);
  }

  for (const e of edges) {
    const startNodeId = e.start;
    const endNodeId = e.end;
    if (!startNodeId || !endNodeId) {
      continue;
    }
    const startNode = byId.get(startNodeId);
    const endNode = byId.get(endNodeId);
    if (!startNode || !endNode) {
      continue;
    }

    const startX = startNode.x ?? 0;
    const startY = startNode.y ?? 0;
    const endX = endNode.x ?? 0;
    const endY = endNode.y ?? 0;

    // Calculate intersection points using node's intersect method (like ELK layout)
    const getIntersection = (node: MermaidNode, outside: { x: number; y: number }) => {
      const nodeWithIntersect = node as MermaidNode & {
        intersect?: (point: { x: number; y: number }) => { x: number; y: number } | null;
      };
      if (!nodeWithIntersect?.intersect) {
        return null;
      }
      const res = nodeWithIntersect.intersect(outside);
      if (!res) {
        return null;
      }
      const bounds = { x: node.x ?? 0, y: node.y ?? 0 };
      const wrongSide =
        (outside.x < bounds.x && res.x > bounds.x) || (outside.x > bounds.x && res.x < bounds.x);
      if (wrongSide) {
        return null;
      }
      const dist = Math.hypot(outside.x - res.x, outside.y - res.y);
      if (dist <= EPS) {
        return null;
      }
      return res;
    };

    const startPoint = getIntersection(startNode, { x: endX, y: endY }) ?? { x: startX, y: startY };
    const endPoint = getIntersection(endNode, { x: startX, y: startY }) ?? { x: endX, y: endY };

    e.points = [startPoint, endPoint];
  }

  return data;
}
