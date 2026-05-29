import type { Graph, OrderedLayers, Coordinates, NodeId, EdgeRef } from './helpers.js';
import { COORDINATES } from './config.js';
import { buildTopLaneOrder, createTopLaneResolver } from './phase2.options.js';

export interface CoordOptions {
  layerGap?: number; // vertical distance between layers
  nodeGap?: number; // horizontal gap between siblings inside a lane
  laneGap?: number; // horizontal gap between lanes (clusters)
  direction?: 'TB' | 'LR' | 'BT' | 'RL'; // layout direction for proper spacing
}

export function assignCoordinates(
  ordered: OrderedLayers,
  gWithDummies: Graph,
  opts?: CoordOptions
): Coordinates {
  const layerGap = opts?.layerGap ?? COORDINATES.DEFAULT_LAYER_GAP;
  const nodeGap = opts?.nodeGap ?? COORDINATES.DEFAULT_NODE_GAP;
  const laneGap = opts?.laneGap ?? nodeGap * 2;
  const direction = opts?.direction ?? 'TB';
  const isHorizontal = direction === 'LR' || direction === 'RL';

  const layers = ordered.layers;

  const x: Record<NodeId, number> = Object.create(null);
  const y: Record<NodeId, number> = Object.create(null);

  // Base placement: width/height aware with lane-aware packing
  const getNode = (id: NodeId) => gWithDummies.nodeById.get(id) as any;
  const getWidth = (id: NodeId) => getNode(id)?.width ?? 0;
  const getHeight = (id: NodeId) => getNode(id)?.height ?? 0;
  const topLaneOf = createTopLaneResolver(gWithDummies);
  const laneOrderGlobal = buildTopLaneOrder(gWithDummies);

  // Precompute max height per layer for vertical spacing
  const layerHeights: number[] = layers.map((layer) =>
    layer.reduce((m, v) => Math.max(m, getHeight(v)), 0)
  );

  // For LR/RL layouts, compute additional gap needed between adjacent layers
  // based on the widths of nodes (which become horizontal after transform)
  // This ensures nodes don't overlap horizontally after the direction transform
  const extraLayerGaps: number[] = [];
  if (isHorizontal) {
    for (let i = 0; i + 1 < layers.length; i++) {
      // Find the max width of nodes in this layer and the next layer
      const thisLayerMaxWidth = layers[i].reduce((m, v) => Math.max(m, getWidth(v)), 0);
      const nextLayerMaxWidth = layers[i + 1].reduce((m, v) => Math.max(m, getWidth(v)), 0);
      const thisLayerMaxHeight = layerHeights[i];
      const nextLayerMaxHeight = layerHeights[i + 1];

      // The normal spacing is based on heights; we need extra space if widths are larger
      // After LR transform: TB's (height/2 + layerGap + height/2) becomes horizontal distance
      // We need: (width/2 + gap + width/2) >= some minimum
      const normalSpacing = thisLayerMaxHeight / 2 + nextLayerMaxHeight / 2;
      const requiredSpacing = (thisLayerMaxWidth + nextLayerMaxWidth) / 2;
      const extraNeeded = Math.max(0, requiredSpacing - normalSpacing - layerGap);
      extraLayerGaps.push(extraNeeded);
    }
  }

  // Determine which lanes actually have nodes and compute column widths
  const lanesUsedSet = new Set<string | null>();
  for (const layer of layers) {
    for (const id of layer) {
      lanesUsedSet.add(topLaneOf(id));
    }
  }
  const hasNullLane = lanesUsedSet.has(null);
  const lanesUsed = laneOrderGlobal.filter((L) => lanesUsedSet.has(L));
  const laneOrderColumns: (string | null)[] = [...(hasNullLane ? [null] : []), ...lanesUsed];

  const laneWidth: Record<string, number> = Object.create(null);
  for (const L of lanesUsed) {
    laneWidth[L] = 0;
  }
  if (hasNullLane) {
    (laneWidth as any).null = 0 as any;
  }
  // For each layer, compute total width per lane (sum of widths + gaps) and take max across layers
  for (const layer of layers) {
    const perLane: Record<string, string[]> = Object.create(null);
    const nullIds: string[] = [];
    for (const id of layer) {
      const L = topLaneOf(id);
      if (L === null) {
        nullIds.push(id);
      } else {
        (perLane[L] ||= []).push(id);
      }
    }
    for (const [L, ids] of Object.entries(perLane)) {
      const total =
        ids.reduce((s, id) => s + getWidth(id), 0) + nodeGap * Math.max(0, ids.length - 1);
      laneWidth[L] = Math.max(laneWidth[L] ?? 0, total);
    }
    if (hasNullLane && nullIds.length) {
      const totalNull =
        nullIds.reduce((s, id) => s + getWidth(id), 0) + nodeGap * Math.max(0, nullIds.length - 1);
      (laneWidth as any).null = Math.max((laneWidth as any).null ?? 0, totalNull) as any;
    }
  }

  // Compute lane centers across all layers (centered around x=0)
  const centerX = new Map<string | null, number>();
  {
    const widths = laneOrderColumns.map(
      (L) => (L === null ? ((laneWidth as any).null as number) : laneWidth[L]) ?? 0
    );
    const totalW =
      widths.reduce((a, b) => a + b, 0) + laneGap * Math.max(0, laneOrderColumns.length - 1);
    let cursor = -totalW / 2;
    for (let i = 0; i < laneOrderColumns.length; i++) {
      const L = laneOrderColumns[i];
      const w = widths[i] ?? 0;
      const cx = cursor + w / 2;
      centerX.set(L, cx);
      cursor += w;
      if (i < laneOrderColumns.length - 1) {
        cursor += laneGap;
      }
    }
  }

  let yOffset = 0;
  for (const [li, layer] of layers.entries()) {
    const layerH = layerHeights[li] ?? 0;

    // Group nodes by top-level lane
    const byLane = new Map<string | null, NodeId[]>();
    for (const id of layer) {
      const laneId = topLaneOf(id);
      const arr = byLane.get(laneId) ?? [];
      arr.push(id);
      byLane.set(laneId, arr);
    }

    // Place nodes per lane at fixed column centers
    for (const L of laneOrderColumns) {
      const nodesInLane = byLane.get(L) ?? [];
      if (nodesInLane.length === 0) {
        continue;
      }
      const cx = centerX.get(L)!;
      if (nodesInLane.length === 1) {
        const id = nodesInLane[0];
        x[id] = cx;
        y[id] = yOffset + layerH / 2;
      } else {
        // Phase 3 already produced lane-aware ordering — preserve it.
        // Just spread multiple nodes within the lane around the center to avoid overlap.
        const widths = nodesInLane.map((id) => getWidth(id));
        const total = widths.reduce((a, b) => a + b, 0) + nodeGap * (nodesInLane.length - 1);
        let start = cx - total / 2;
        for (const [i, id] of nodesInLane.entries()) {
          const w = widths[i];
          x[id] = start + w / 2;
          y[id] = yOffset + layerH / 2;
          start += w + nodeGap;
        }
      }
    }

    // Add extra gap for LR/RL layouts where node widths require more horizontal spacing
    const extraGap = extraLayerGaps[li] ?? 0;
    yOffset += layerH + layerGap + extraGap;
  }

  // Align dummy chains for each original edge: set dummy x to midpoint between src and dst.
  const byRef = new Map<string, EdgeRef[]>();
  for (const e of gWithDummies.edges) {
    const rid = e.ref.id;
    if (!byRef.has(rid)) {
      byRef.set(rid, []);
    }
    byRef.get(rid)!.push(e);
  }
  for (const [, chainEdges] of byRef) {
    if (chainEdges.length === 0) {
      continue;
    }
    const ref = chainEdges[0].ref; // original edge
    const src = ref.start!;
    const dst = ref.end!;
    if (src == null || dst == null) {
      continue;
    }
    const midX = Math.round(((x[src] ?? 0) + (x[dst] ?? 0)) / 2);
    const involved = new Set<NodeId>();
    for (const e of chainEdges) {
      involved.add(e.src);
      involved.add(e.dst);
    }
    for (const vid of involved) {
      if (vid === src || vid === dst) {
        continue;
      }
      const node = gWithDummies.nodeById.get(vid) as any;
      if (node?.isDummy) {
        x[vid] = midX;
      }
    }
  }

  return { x, y };
}
