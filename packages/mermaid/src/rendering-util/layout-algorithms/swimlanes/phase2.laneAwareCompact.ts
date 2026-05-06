import type { Graph, Layering, NodeId } from './helpers.js';
import { incoming, topoSortIfAcyclic, normalizeGraph } from './phase0.helpers.js';
import type { LayeringOptions } from './phase2.options.js';
import { buildTopLaneMap } from './phase2.options.js';

// cspell:ignore preds

// Lane-aware compact layering: one node per (layer, lane); inter-lane edges can stay on same layer
export function assignLayers_LaneAwareCompact(gAcyclic: Graph, opts?: LayeringOptions): Layering {
  const g = normalizeGraph(gAcyclic);
  const order = topoSortIfAcyclic(g) ?? [...g.nodes].sort();

  // Determine a lane id for each node: top-level parent id, or fall back to node id if none
  const topLaneMap = buildTopLaneMap(g);
  const laneOf = (id: NodeId): string => topLaneMap.get(id) ?? id;

  const rankOf: Record<NodeId, number> = Object.create(null);
  const nextFree = new Map<string, number>();

  // Helper: edge weight w(u,v) = 1 if same lane else 0, when ignoring cross-lane constraints;
  // otherwise 1 for all edges.
  const edgeWeight = (u: NodeId, v: NodeId): number => {
    const ignoreCrossLane = opts?.ignoreCrossLaneEdges ?? true;
    if (ignoreCrossLane) {
      return laneOf(u) === laneOf(v) ? 1 : 0;
    }
    return 1;
  };

  for (const v of order) {
    const node = g.nodeById.get(v) as any;
    if (node?.isGroup) {
      continue;
    } // do not assign ranks/capacity to lane/group containers
    const preds = incoming(g, v);
    let base = 0;
    if (preds.length > 0) {
      for (const e of preds) {
        const u = e.src;
        const ru = rankOf[u] ?? 0;
        base = Math.max(base, ru + edgeWeight(u, v));
      }
    }
    const lane = laneOf(v);
    const nf = nextFree.get(lane) ?? 0;
    const L = Math.max(base, nf);
    rankOf[v] = L;
    nextFree.set(lane, L + 1);
  }

  // Build layers from assigned ranks
  let maxRank = 0;
  for (const v of g.nodes) {
    maxRank = Math.max(maxRank, rankOf[v] ?? 0);
  }
  const layers: NodeId[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const v of order) {
    const node = g.nodeById.get(v) as any;
    if (node?.isGroup) {
      continue;
    }
    const r = Math.max(0, rankOf[v] ?? 0);
    layers[r].push(v);
  }

  return { layers, rankOf, dummy: new Set<NodeId>() };
}
