import type { LayoutData, Node as MermaidNode, Edge as MermaidEdge } from '../../types.js';

// Core aliases used by the Sugiyama pipeline
export type Layout = LayoutData;
export type Node = MermaidNode;
export type NodeId = Node['id'];
export type EdgeId = MermaidEdge['id'];

// Light edge view used by the heuristics (keeps ref to original Mermaid edge)
export interface EdgeRef {
  id: EdgeId;
  src: NodeId; // equals MermaidEdge.start
  dst: NodeId; // equals MermaidEdge.end
  weight?: number;
  ref: MermaidEdge;
}

// Graph view used internally by the Sugiyama phases
export interface Graph {
  nodes: NodeId[];
  edges: EdgeRef[];
  layout: Layout; // gives access to full Node/Edge objects when needed
  nodeById: Map<NodeId, Node>; // convenience map built from layout.nodes
}

// After layering
export interface Layering {
  layers: NodeId[][]; // top-to-bottom list of layers
  rankOf: Record<NodeId, number>; // node -> layer index
  dummy?: Set<NodeId>; // synthetic ids for proper layering
}

// After ordering
export interface OrderedLayers {
  layers: NodeId[][]; // each inner array is left-to-right order
}

// After coordinates
export interface Coordinates {
  x: Record<NodeId, number>;
  y: Record<NodeId, number>;
  edgePoints?: Record<EdgeId, { x: number; y: number }[]>; // polyline per edge
}

// Alias used in algorithm signatures
export type Edge = EdgeRef;

export interface WriteBackOptions {
  layerGap?: number;
  nodeGap?: number;
}

/**
 * Prepare layout data specifically for the swimlanes layout.
 * Ensures group nodes render using the dedicated 'swimlane' cluster shape
 * and propagates the diagram direction to each lane node.
 */
export function prepareLayoutForSwimlanes(layout: LayoutData): void {
  const direction = (layout as any).direction;
  for (const node of layout.nodes ?? []) {
    if (node.isGroup) {
      node.shape = 'swimlane';
      // Propagate direction to lane nodes so the cluster shape can render appropriately
      if (direction) {
        (node as any).direction = direction;
      }
    }
  }
}

// Build a thin Graph view from LayoutData that the Sugiyama phases consume
export function toGraphView(layout: LayoutData): Graph {
  const nodeById = new Map<NodeId, Node>();
  for (const n of layout.nodes ?? []) {
    nodeById.set(n.id, n);
  }

  const edges: EdgeRef[] = [];
  for (const e of layout.edges ?? []) {
    const src = typeof e.start === 'string' ? e.start : undefined;
    const dst = typeof e.end === 'string' ? e.end : undefined;
    if (!src || !dst) {
      // Skip malformed edges for now
      continue;
    }
    // Exclude labelled originals from Sugiyama: their routing is carried by
    // the two layout-only virtual edges A→label and label→B, which create the
    // correct layer/ordering constraints. Including the original as well would
    // double-count rank pressure and inflate crossing penalties.
    if ((e as MermaidEdge & { labelNodeId?: string }).labelNodeId) {
      continue;
    }
    edges.push({ id: e.id, src, dst, ref: e });
  }

  // Preserve original order from layout.nodes, but reverse group nodes to fix flowDb ordering
  const allNodes = layout.nodes ?? [];
  const groupNodes = allNodes.filter((n) => n.isGroup);
  const nonGroupNodes = allNodes.filter((n) => !n.isGroup);

  // Reverse group nodes to counteract flowDb's reverse iteration, then add non-group nodes
  const nodesInGroupOrder = [...groupNodes].reverse();
  const nodes: NodeId[] = [...nodesInGroupOrder, ...nonGroupNodes].map((n) => n.id);
  return { nodes, edges, layout, nodeById };
}

// Applies computed layer/order/coordinates to LayoutData in-place
export function writeBackToLayoutData(
  g: Graph,
  ordered: OrderedLayers,
  coords: Coordinates,
  opts?: WriteBackOptions
): void {
  const { layout } = g;
  const nodeMap = g.nodeById;
  // Write layer/order from ordered.layers
  const layerGap = opts?.layerGap ?? 100;
  const nodeGap = opts?.nodeGap ?? 40;

  // Set layer/order and coordinates
  let layerIndex = 0;
  for (const layer of ordered.layers) {
    let orderIndex = 0;
    for (const id of layer) {
      const node = nodeMap.get(id);
      if (!node) {
        orderIndex++;
        continue;
      }
      node.layer = layerIndex;
      node.order = orderIndex;
      const x = coords.x[id] ?? orderIndex * nodeGap;
      const y = coords.y[id] ?? layerIndex * layerGap;
      node.x = x;
      node.y = y;
      orderIndex++;
    }
    layerIndex++;
  }

  // Also position group (cluster/lane) nodes based on their children's bounds.
  // First compute per-group bounds, then normalize all top-level lanes to share
  // the same vertical extent so lane headers align visually.
  const allNodes = layout.nodes ?? [];
  const groupBounds = new Map<NodeId, { minX: number; maxX: number; minY: number; maxY: number }>();
  const topLevelGroups: Node[] = [];
  for (const group of allNodes) {
    if (!group?.isGroup) {
      continue;
    }
    if (!group.parentId) {
      topLevelGroups.push(group);
    }
    const children = allNodes.filter((n) => n.parentId === group.id);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const child of children) {
      const cx = child.x ?? coords.x[child.id];
      const cy = child.y ?? coords.y[child.id];
      const cw = child.width ?? 0;
      const ch = child.height ?? 0;
      if (cx != null && cy != null) {
        minX = Math.min(minX, cx - cw / 2);
        maxX = Math.max(maxX, cx + cw / 2);
        minY = Math.min(minY, cy - ch / 2);
        maxY = Math.max(maxY, cy + ch / 2);
      }
    }
    if (minX === Infinity || minY === Infinity) {
      // No measurable children; keep any existing position/size but avoid NaN
      group.x = group.x ?? 0;
      group.y = group.y ?? 0;
      group.width = group.width ?? 0;
      group.height = group.height ?? 0;
    } else {
      const pad = group.padding ?? 20;
      // For swimlanes, we do not add extra horizontal padding to top-level
      // lane groups so that the lane width matches the content width exactly
      // (no extra gap between adjacent lanes). Nested groups still use the
      // configured padding.
      const horizontalPad = group.parentId ? pad : 0;
      const verticalPad = pad;
      const w = Math.max(0, maxX - minX) + horizontalPad;
      const h = Math.max(0, maxY - minY) + verticalPad;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      group.x = cx;
      group.y = cy;
      group.width = w;
      group.height = h;
      groupBounds.set(group.id, { minX, maxX, minY, maxY });
    }
  }

  // Make all top-level lanes the same height so headers align for the pool,
  // and record the top of the content area (min child Y) so swimlane headers
  // can be positioned just above the first row of nodes.
  if (topLevelGroups.length > 0 && groupBounds.size > 0) {
    let globalMinY = Infinity;
    let globalMaxY = -Infinity;
    let maxPad = 0;
    for (const lane of topLevelGroups) {
      const pad = lane.padding ?? 20;
      if (pad > maxPad) {
        maxPad = pad;
      }
      const b = groupBounds.get(lane.id);
      if (!b) {
        continue;
      }
      globalMinY = Math.min(globalMinY, b.minY);
      globalMaxY = Math.max(globalMaxY, b.maxY);
    }
    if (globalMinY !== Infinity && globalMaxY !== -Infinity) {
      const contentHeight = Math.max(0, globalMaxY - globalMinY);
      // Use full padding above and below the content so the title band can
      // comfortably fit the lane label across all lanes. Ensure that the
      // vertical margin (and thus the header band height) is at least a
      // reasonable minimum so the label does not get cramped.
      // Vertical margin around the content inside each lane. This controls both
      // how much space is available for the lane title and how much padding we
      // get between the title divider and the first row of nodes. We choose a
      // margin that is comfortably larger than typical title heights so that we
      // always end up with a bit of gap above the nodes.
      const minHeaderMargin = 36;
      const verticalMargin = Math.max(maxPad, minHeaderMargin);
      const laneHeight = contentHeight + 2 * verticalMargin;
      const centerY = (globalMinY + globalMaxY) / 2;
      for (const lane of topLevelGroups) {
        lane.y = centerY;
        lane.height = laneHeight;
        // For rendering, remember the global top of the content area so that
        // all lane titles can be aligned just above the first row of nodes.
        (lane as any).swimlaneContentTop = globalMinY;
      }

      // Then, compute lane widths so that:
      // - lane centers stay at their current x positions,
      // - lanes share boundaries with no gaps between bodies, and
      // - each lane is at least as wide as its content.
      const sortedLanes = [...topLevelGroups].sort((a, b) => {
        const ax = a.x ?? 0;
        const bx = b.x ?? 0;
        return ax - bx;
      });

      const laneIds: NodeId[] = [];
      const centers: number[] = [];
      const baseWidths: number[] = [];

      for (const lane of sortedLanes) {
        const b = groupBounds.get(lane.id);
        if (!b) {
          continue;
        }
        const contentWidth = Math.max(0, b.maxX - b.minX);
        const cx = lane.x ?? (b.minX + b.maxX) / 2;
        laneIds.push(lane.id);
        centers.push(cx);
        baseWidths.push(contentWidth);
      }

      const count = laneIds.length;
      if (count > 0) {
        const laneWidths = new Map<NodeId, number>();

        if (count === 1) {
          laneWidths.set(laneIds[0], baseWidths[0]);
        } else {
          const d: number[] = [];
          for (let i = 0; i < count - 1; i++) {
            d.push(centers[i + 1] - centers[i]);
          }

          const u: number[] = new Array(count);
          u[0] = 0;
          for (let i = 0; i < count - 1; i++) {
            u[i + 1] = 2 * d[i] - u[i];
          }

          let lowerBound = 0;
          let upperBound = Number.POSITIVE_INFINITY;
          for (let i = 0; i < count; i++) {
            const baseW = baseWidths[i];
            if (i % 2 === 0) {
              // even index: w[i] = u[i] + x >= baseW  =>  x >= baseW - u[i]
              lowerBound = Math.max(lowerBound, baseW - u[i]);
            } else {
              // odd index: w[i] = u[i] - x >= baseW  =>  x <= u[i] - baseW
              upperBound = Math.min(upperBound, u[i] - baseW);
            }
          }

          let x = lowerBound;
          if (lowerBound <= upperBound) {
            x = (lowerBound + upperBound) / 2;
          } else {
            // Fall back to clamping at lowerBound; this keeps all lanes at least
            // as wide as their content. In degenerate cases this can allow small
            // overlaps or gaps, but typical swimlane layouts satisfy the bounds.
            x = lowerBound;
          }

          for (let i = 0; i < count; i++) {
            const w = u[i] + (i % 2 === 0 ? x : -x);
            const finalWidth = Math.max(baseWidths[i], w);
            laneWidths.set(laneIds[i], finalWidth);
          }
        }

        for (const lane of topLevelGroups) {
          const w = laneWidths.get(lane.id);
          if (w != null) {
            lane.width = w;
          }
        }
      }

      // Debug: record how swimlane lanes are sized and positioned.

      console.debug('SWIMLANE_DEBUG layout lanes', {
        globalMinY,
        globalMaxY,
        contentHeight,
        laneHeight,
        centerY,
        maxPad,
        minHeaderMargin,
        verticalMargin,
        lanes: topLevelGroups.map((lane) => ({
          id: lane.id,
          y: lane.y,
          height: lane.height,
          padding: lane.padding,
          swimlaneContentTop: (lane as any).swimlaneContentTop,
        })),
      });
    }
  }

  // Edge polylines
  if (coords.edgePoints) {
    for (const [eid, points] of Object.entries(coords.edgePoints)) {
      const edge = (layout.edges ?? []).find((e) => e.id === eid);
      if (edge) {
        edge.points = points;
      }
    }
  }
}
