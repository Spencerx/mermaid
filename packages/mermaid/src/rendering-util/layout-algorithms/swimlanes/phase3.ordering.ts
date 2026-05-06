import type { Graph, Layering, OrderedLayers, NodeId, Edge } from './helpers.js';
import { buildLayerIndex } from './phase0.helpers.js';
import { ORDERING } from './config.js';

export interface OrderingOptions {
  sweeps?: number; // default 3
  useTranspose?: boolean; // default true
  heuristic?: 'median' | 'barycenter'; // default 'median'
}

/**
 * Resolve the top-level lane (root group) for a node.
 * Placeholder dummy nodes (isDummy && !isEdgeLabel) have null lane.
 * Edge label nodes use their parentId lane.
 */
function topLaneOf(id: NodeId, g: Graph): string | null {
  const node = g.nodeById.get(id) as any;
  if (!node) {
    return null;
  }
  // Placeholder dummy nodes don't belong to any lane
  if (node.isDummy && !node.isEdgeLabel) {
    return null;
  }
  let pid: string | undefined = node.parentId;
  if (!pid) {
    return null;
  }
  let parent = g.nodeById.get(pid) as any;
  while (parent?.parentId) {
    pid = parent.parentId;
    parent = g.nodeById.get(pid!) as any;
  }
  return pid ?? null;
}

/**
 * Compute the fixed left-to-right lane order from the graph's layout.
 * Top-level group nodes (isGroup && !parentId) define lanes; their order
 * is reversed to match the visual left-to-right appearance.
 */
function computeLaneOrder(g: Graph): string[] {
  const allTopLanes: string[] = [];
  for (const n of g.layout.nodes ?? []) {
    const nn: any = n;
    if (nn?.isGroup && !nn?.parentId) {
      allTopLanes.push(nn.id);
    }
  }
  return [...new Set(allTopLanes)].reverse();
}

function median(values: number[]): number {
  const n = values.length;
  if (n === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const a = [...values].sort((x, y) => x - y);
  if (n % 2 === 1) {
    return a[(n - 1) / 2];
  }
  return 0.5 * (a[n / 2 - 1] + a[n / 2]);
}

function barycenter(values: number[]): number {
  if (values.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const s = values.reduce((acc, v) => acc + v, 0);
  return s / values.length;
}

export function countCrossingsBetweenAdjacent(
  upper: NodeId[],
  lower: NodeId[],
  edges: Edge[]
): number {
  // Filter edges between these two layers
  const upperSet = new Set(upper);
  const lowerSet = new Set(lower);
  const upperIndex = buildLayerIndex(upper);
  const lowerIndex = buildLayerIndex(lower);
  const pairs: { u: number; v: number }[] = [];
  for (const e of edges) {
    if (upperSet.has(e.src) && lowerSet.has(e.dst)) {
      pairs.push({ u: upperIndex.get(e.src)!, v: lowerIndex.get(e.dst)! });
    }
  }
  // Sort by u, count inversions in v
  pairs.sort((a, b) => (a.u === b.u ? a.v - b.v : a.u - b.u));
  const vs = pairs.map((p) => p.v);
  // Count inversions (O(n log n)) using merge sort
  const tmp = Array<number>(vs.length);
  const invCount = (arr: number[], l: number, r: number): number => {
    if (r - l <= 1) {
      return 0;
    }
    const m = (l + r) >> 1;
    let cnt = invCount(arr, l, m) + invCount(arr, m, r);
    let i = l,
      j = m,
      k = l;
    while (i < m || j < r) {
      if (j >= r || (i < m && arr[i] <= arr[j])) {
        tmp[k++] = arr[i++];
      } else {
        tmp[k++] = arr[j++];
        cnt += m - i;
      }
    }
    for (let t = l; t < r; t++) {
      arr[t] = tmp[t];
    }
    return cnt;
  };
  return invCount(vs, 0, vs.length);
}

export function totalCrossings(layers: NodeId[][], edges: Edge[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < layers.length; i++) {
    sum += countCrossingsBetweenAdjacent(layers[i], layers[i + 1], edges);
  }
  return sum;
}

/**
 * Sort a subset of nodes by their median/barycenter score relative to a fixed layer.
 * This is the core sorting logic extracted for reuse per-lane.
 */
function sortByHeuristic(
  nodes: NodeId[],
  fixedIndex: Map<NodeId, number>,
  edges: Edge[],
  direction: 'down' | 'up',
  heuristic: 'median' | 'barycenter',
  currentLayerIndex: Map<NodeId, number>,
  _targetSet: Set<NodeId>
): NodeId[] {
  const neighborPositions = new Map<NodeId, number[]>();
  for (const v of nodes) {
    neighborPositions.set(v, []);
  }
  for (const e of edges) {
    if (direction === 'down') {
      if (fixedIndex.has(e.src) && neighborPositions.has(e.dst)) {
        neighborPositions.get(e.dst)!.push(fixedIndex.get(e.src)!);
      }
    } else {
      if (fixedIndex.has(e.dst) && neighborPositions.has(e.src)) {
        neighborPositions.get(e.src)!.push(fixedIndex.get(e.dst)!);
      }
    }
  }
  const score = (arr: number[]) => (heuristic === 'median' ? median(arr) : barycenter(arr));
  return [...nodes].sort((a, b) => {
    const sa = score(neighborPositions.get(a)!);
    const sb = score(neighborPositions.get(b)!);
    if (sa === sb) {
      const ia = currentLayerIndex.get(a) ?? 0;
      const ib = currentLayerIndex.get(b) ?? 0;
      if (ia !== ib) {
        return ia - ib;
      }
      return a.localeCompare(b);
    }
    if (!isFinite(sa) && !isFinite(sb)) {
      const ia = currentLayerIndex.get(a) ?? 0;
      const ib = currentLayerIndex.get(b) ?? 0;
      if (ia !== ib) {
        return ia - ib;
      }
      return a.localeCompare(b);
    }
    if (!isFinite(sa)) {
      return 1;
    }
    if (!isFinite(sb)) {
      return -1;
    }
    return sa - sb;
  });
}

function reorderLayer(
  fixedLayer: NodeId[],
  targetLayer: NodeId[],
  edges: Edge[],
  direction: 'down' | 'up',
  heuristic: 'median' | 'barycenter',
  g?: Graph,
  laneOrder?: string[]
): NodeId[] {
  const fixedIndex = buildLayerIndex(fixedLayer);
  const currIndex = buildLayerIndex(targetLayer);
  const targetSet = new Set(targetLayer);

  // If no lane info, fall back to flat reorder (original behavior)
  if (!g || !laneOrder || laneOrder.length === 0) {
    return sortByHeuristic(
      targetLayer,
      fixedIndex,
      edges,
      direction,
      heuristic,
      currIndex,
      targetSet
    );
  }

  // Partition target layer nodes by lane
  const byLane = new Map<string | null, NodeId[]>();
  for (const id of targetLayer) {
    const lane = topLaneOf(id, g);
    const arr = byLane.get(lane) ?? [];
    arr.push(id);
    byLane.set(lane, arr);
  }

  // Reorder nodes within each lane independently
  const result: NodeId[] = [];

  // First, place lane-grouped nodes in lane order
  for (const lane of laneOrder) {
    const nodesInLane = byLane.get(lane);
    if (!nodesInLane || nodesInLane.length === 0) {
      continue;
    }
    const sorted = sortByHeuristic(
      nodesInLane,
      fixedIndex,
      edges,
      direction,
      heuristic,
      currIndex,
      targetSet
    );
    result.push(...sorted);
  }

  // Then, handle null-lane nodes (long-edge dummies without a parent).
  // Compute their barycenter and insert them adjacent to the lane whose
  // center position is closest to their barycenter.
  const nullNodes = byLane.get(null);
  if (nullNodes && nullNodes.length > 0) {
    // Sort null-lane nodes by their barycenter across the full layer
    const sorted = sortByHeuristic(
      nullNodes,
      fixedIndex,
      edges,
      direction,
      heuristic,
      currIndex,
      targetSet
    );

    // For each null-lane node, find the best insertion position
    // based on its connections to nodes already in the result
    for (const nid of sorted) {
      // Compute the barycenter position of this node's neighbors in the fixed layer
      const positions: number[] = [];
      for (const e of edges) {
        if (direction === 'down') {
          if (fixedIndex.has(e.src) && e.dst === nid) {
            positions.push(fixedIndex.get(e.src)!);
          }
        } else {
          if (fixedIndex.has(e.dst) && e.src === nid) {
            positions.push(fixedIndex.get(e.dst)!);
          }
        }
      }
      const bc = positions.length > 0 ? barycenter(positions) : Number.POSITIVE_INFINITY;

      // Find the best insertion point: scan result and insert where the
      // node's barycenter fits relative to its neighbors
      let bestIdx = result.length; // default: append at end
      if (isFinite(bc)) {
        // Find insertion point by comparing barycenter against positions of
        // nodes already placed. Insert before the first node whose fixed-layer
        // neighbor position is greater than this node's barycenter.
        for (const [i, rid] of result.entries()) {
          const rPositions: number[] = [];
          for (const e of edges) {
            if (direction === 'down') {
              if (fixedIndex.has(e.src) && e.dst === rid) {
                rPositions.push(fixedIndex.get(e.src)!);
              }
            } else {
              if (fixedIndex.has(e.dst) && e.src === rid) {
                rPositions.push(fixedIndex.get(e.dst)!);
              }
            }
          }
          const rBc = rPositions.length > 0 ? barycenter(rPositions) : Number.POSITIVE_INFINITY;
          if (bc < rBc) {
            bestIdx = i;
            break;
          }
        }
      }
      result.splice(bestIdx, 0, nid);
    }
  }

  return result;
}

function transposeImprove(
  upper: NodeId[],
  current: NodeId[],
  edges: Edge[],
  next?: NodeId[],
  g?: Graph
): NodeId[] {
  const best = [...current];
  const upperSet = new Set(upper);
  const layerSet = new Set(current);
  const nextSet = next ? new Set(next) : null;

  const edgesIn = edges.filter((e) => upperSet.has(e.src) && layerSet.has(e.dst));
  const edgesOut = nextSet
    ? edges.filter((e) => layerSet.has(e.src) && nextSet.has(e.dst))
    : undefined;

  const crossingScore = (order: NodeId[]): number => {
    let score = countCrossingsBetweenAdjacent(upper, order, edgesIn);
    if (edgesOut && next) {
      score += countCrossingsBetweenAdjacent(order, next, edgesOut);
    }
    return score;
  };

  // Precompute lane membership for same-lane check
  const laneOf = g ? new Map<NodeId, string | null>() : null;
  if (g && laneOf) {
    for (const id of current) {
      laneOf.set(id, topLaneOf(id, g));
    }
  }

  let improved = true;
  let bestScore = crossingScore(best);
  while (improved) {
    improved = false;
    for (let i = 0; i + 1 < best.length; i++) {
      // Only swap nodes in the same lane (or both null-lane)
      if (laneOf) {
        const laneA = laneOf.get(best[i]);
        const laneB = laneOf.get(best[i + 1]);
        if (laneA !== laneB) {
          continue; // never swap across lane boundaries
        }
      }

      const prev = bestScore;
      [best[i], best[i + 1]] = [best[i + 1], best[i]];
      const nextScore = crossingScore(best);
      if (nextScore < prev) {
        bestScore = nextScore;
        improved = true;
      } else {
        [best[i], best[i + 1]] = [best[i + 1], best[i]];
      }
    }
  }
  return best;
}

/**
 * Orders nodes within each layer to minimize edge crossings using layer-by-layer sweep heuristics.
 *
 * **Algorithm: Layer-by-Layer Sweep (Median/Barycenter Heuristic)**
 *
 * This implements the classic Sugiyama framework Phase 3: vertex ordering within layers.
 * The goal is to minimize the number of edge crossings between adjacent layers.
 *
 * **Process:**
 * 1. **Top-Down Sweep:** For each layer i (from top to bottom):
 *    - Fix layer i-1
 *    - Reorder layer i based on the median (or barycenter) of neighbor positions in layer i-1
 *    - Optionally apply transpose improvement (local swaps that reduce crossings)
 *
 * 2. **Bottom-Up Sweep:** For each layer i (from bottom to top):
 *    - Fix layer i+1
 *    - Reorder layer i based on the median (or barycenter) of neighbor positions in layer i+1
 *    - Optionally apply transpose improvement
 *
 * 3. **Repeat:** Perform multiple sweeps (default: 3) to converge to a local optimum
 *
 * **Heuristics:**
 * - **Median:** For each node, compute the median position of its neighbors in the adjacent layer.
 *   More stable and often produces better results for sparse graphs.
 * - **Barycenter:** Compute the average (barycenter) position of neighbors.
 *   Faster to compute but can be less stable.
 *
 * **Transpose Improvement:**
 * After each sweep, try swapping adjacent nodes if it reduces crossings. This is a local
 * optimization that can escape some local minima.
 *
 * **Crossing Count:**
 * Uses an efficient O(m log m) algorithm based on merge-sort inversion counting, where m is
 * the number of edges between two layers.
 *
 * **Time Complexity:** O(sweeps × layers × (n log n + m log m))
 * where n = nodes per layer, m = edges between layers
 *
 * **Note:** This is an NP-hard problem, so we use heuristics to find good (not optimal) solutions.
 *
 * @param layering - The layering from Phase 2 (nodes assigned to layers)
 * @param gWithDummies - Graph with dummy nodes inserted for long edges
 * @param opts - Options: sweeps (default 3), useTranspose (default true), heuristic (default 'median')
 * @returns OrderedLayers with nodes ordered within each layer to minimize crossings
 */
export function orderLayers(
  layering: Layering,
  gWithDummies: Graph,
  opts?: OrderingOptions
): OrderedLayers {
  const sweeps = opts?.sweeps ?? ORDERING.DEFAULT_SWEEPS;
  const useTranspose = opts?.useTranspose ?? ORDERING.DEFAULT_USE_TRANSPOSE;
  const heuristic = opts?.heuristic ?? ORDERING.DEFAULT_HEURISTIC;

  // Start with deterministic initial order per layer (preserve given order)
  const layers = layering.layers.map((l) => [...l]);
  const edges = gWithDummies.edges;

  // Compute lane order for lane-aware crossing minimization (Siebenhaller Lemma 4.4)
  const laneOrder = computeLaneOrder(gWithDummies);

  // Perform top-down / bottom-up sweeps
  for (let s = 0; s < sweeps; s++) {
    // Top-down: reorder layer i based on neighbors in layer i-1
    for (let i = 1; i < layers.length; i++) {
      layers[i] = reorderLayer(
        layers[i - 1],
        layers[i],
        edges,
        'down',
        heuristic,
        gWithDummies,
        laneOrder
      );
      if (useTranspose) {
        layers[i] = transposeImprove(layers[i - 1], layers[i], edges, layers[i + 1], gWithDummies);
      }
    }
    // Bottom-up: reorder layer i based on neighbors in layer i+1
    for (let i = layers.length - 2; i >= 0; i--) {
      layers[i] = reorderLayer(
        layers[i + 1],
        layers[i],
        edges,
        'up',
        heuristic,
        gWithDummies,
        laneOrder
      );
      if (useTranspose) {
        layers[i] = transposeImprove(layers[i + 1], layers[i], edges, layers[i - 1], gWithDummies);
      }
    }
  }

  return { layers };
}
