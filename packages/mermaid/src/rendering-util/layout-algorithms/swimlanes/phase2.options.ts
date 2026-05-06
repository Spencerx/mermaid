import type { Graph, NodeId } from './helpers.js';

/**
 * Options controlling how layers are assigned in the Sugiyama pipeline.
 */
export interface LayeringOptions {
  widthBound?: number;
  preferLongEdgesStraight?: boolean;
  /** If true, a node with exactly one incoming edge inherits its predecessor's layer. */
  compactSingleInput?: boolean;
  /** If true, ignore edges from other lanes when calculating layer positions. */
  ignoreCrossLaneEdges?: boolean;
  /** If true, try to lift nodes to reduce crossings between layers. */
  optimizeRanksByCrossings?: boolean;
}

/**
 * Computes the "top lane" (outermost group container) for each node.
 *
 * Returns a map from node id -\> lane id (top-level group) or null if the node
 * does not belong to any lane.
 */
export function buildTopLaneMap(g: Graph): Map<NodeId, string | null> {
  const cache = new Map<NodeId, string | null>();

  const resolve = (id: NodeId): string | null => {
    if (cache.has(id)) {
      return cache.get(id)!;
    }
    const node = g.nodeById.get(id) as any;
    if (!node) {
      cache.set(id, null);
      return null;
    }
    const parentId = node.parentId as NodeId | undefined;
    if (!parentId) {
      cache.set(id, null);
      return null;
    }
    const parentLane = resolve(parentId);
    const lane = parentLane ?? parentId;
    cache.set(id, lane);
    return lane;
  };

  for (const id of g.nodes) {
    resolve(id);
  }
  return cache;
}
