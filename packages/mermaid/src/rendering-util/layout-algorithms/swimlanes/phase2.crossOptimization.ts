import type { Graph, NodeId, EdgeRef } from './helpers.js';
import { buildLayerIndex } from './phase0.helpers.js';
import { LAYERING } from './config.js';
import { buildTopLaneMap } from './phase2.options.js';
import { buildMultitreeLayerOrder } from './phase2.multitree.order.js';
// cspell:ignore acyclicity preds succs

function countCrossingsBetweenAdjacent(upper: NodeId[], lower: NodeId[], edges: EdgeRef[]): number {
  const upperSet = new Set(upper);
  const lowerSet = new Set(lower);
  const li = buildLayerIndex(lower);
  const vs: number[] = [];
  for (const e of edges) {
    if (upperSet.has(e.src) && lowerSet.has(e.dst)) {
      vs.push(li.get(e.dst)!);
    }
  }
  const tmp = new Array<number>(vs.length);
  const inv = (arr: number[], l: number, r: number): number => {
    if (r - l <= 1) {
      return 0;
    }
    const m = (l + r) >> 1;
    let c = inv(arr, l, m) + inv(arr, m, r);
    let i = l,
      j = m,
      k = l;
    while (i < m || j < r) {
      if (j >= r || (i < m && arr[i] <= arr[j])) {
        tmp[k++] = arr[i++];
      } else {
        tmp[k++] = arr[j++];
        c += m - i;
      }
    }
    for (let t = l; t < r; t++) {
      arr[t] = tmp[t];
    }
    return c;
  };
  return inv(vs, 0, vs.length);
}

function totalCrossings(
  layers: NodeId[][],
  edges: EdgeRef[],
  rankOf: Record<NodeId, number>
): number {
  const expanded: EdgeRef[] = [];
  for (const e of edges) {
    const ru = rankOf[e.src];
    const rv = rankOf[e.dst];
    if (ru == null || rv == null || ru === rv) {
      continue;
    }
    let upper = e.src;
    let lower = e.dst;
    let rUpper = ru;
    let rLower = rv;
    if (ru > rv) {
      upper = e.dst;
      lower = e.src;
      rUpper = rv;
      rLower = ru;
    }
    for (let L = rUpper; L < rLower; L++) {
      expanded.push({ id: `${e.id}@${L}`, src: upper, dst: lower, ref: e.ref });
    }
  }
  let sum = 0;
  for (let i = 0; i + 1 < layers.length; i++) {
    sum += countCrossingsBetweenAdjacent(layers[i], layers[i + 1], expanded);
  }
  return sum;
}

/**
 * Greedy local search that tries to lift nodes to reduce crossings while
 * preserving acyclicity (rank(v) e= rank(u)+1 for every edge u-\>v).
 */
export function optimizeRanksByCrossings(
  g: Graph,
  initialRank: Record<NodeId, number>
): Record<NodeId, number> {
  const rankOf: Record<NodeId, number> = { ...initialRank } as any;
  const preds = new Map<NodeId, NodeId[]>();
  const succs = new Map<NodeId, NodeId[]>();
  for (const v of g.nodes) {
    preds.set(v, []);
    succs.set(v, []);
  }
  for (const e of g.edges) {
    succs.get(e.src)!.push(e.dst);
    preds.get(e.dst)!.push(e.src);
  }

  const topLaneMap = buildTopLaneMap(g);
  const laneOf = (id: NodeId): string | null => topLaneMap.get(id) ?? null;

  const layers = buildMultitreeLayerOrder(g, rankOf, laneOf);
  let best = totalCrossings(layers, g.edges, rankOf);
  const maxPasses = LAYERING.MAX_CROSSING_OPTIMIZATION_PASSES;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    const nodesByRank = [...g.nodes].sort((a, b) => (rankOf[b] ?? 0) - (rankOf[a] ?? 0));
    for (const v of nodesByRank) {
      const r = rankOf[v] ?? 0;
      if (r === 0) {
        continue;
      }
      let lb = 0;
      for (const u of preds.get(v) ?? []) {
        lb = Math.max(lb, (rankOf[u] ?? 0) + 1);
      }
      if (lb >= r) {
        continue;
      }
      const old = r;
      rankOf[v] = lb;
      const trialLayers = buildMultitreeLayerOrder(g, rankOf, laneOf);
      const score = totalCrossings(trialLayers, g.edges, rankOf);
      if (score < best) {
        best = score;
        changed = true;
      } else {
        rankOf[v] = old;
      }
    }
    if (!changed) {
      break;
    }
  }
  return rankOf;
}
