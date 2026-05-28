import type { Graph, Layering, OrderedLayers, Coordinates, Edge } from './helpers.js';
import { normalizeGraph } from './phase0.helpers.js';
import { removeCycles_DFS } from './phase1.cycles.js';

import { assignLayers_Gravity } from './phase2.gravity.js';
import { assignLayers_LaneAwareCompact } from './phase2.laneAwareCompact.js';
import { makeProperLayering } from './phase2.dummies.js';
import { orderLayers } from './phase3.ordering.js';
import { assignCoordinates } from './phase4.coordinates.js';
import { mergeDummies } from './phase4.mergeDummies.js';
import { LAYERING } from './config.js';

export interface LayoutOptions {
  // Layering
  preferLongEdgesStraight?: boolean;
  compactSingleInput?: boolean; // default true for compact swimlanes
  ignoreCrossLaneEdges?: boolean;
  optimizeRanksByCrossings?: boolean;
  // Coordinates
  layerGap?: number;
  nodeGap?: number;
  straightenLongEdges?: boolean;
  // Direction (for proper spacing calculation)
  direction?: 'TB' | 'LR' | 'BT' | 'RL';
}

export interface LayoutResult {
  acyclic: Graph;
  reversed: Edge[];
  layering: Layering;
  ordered: OrderedLayers;
  coordinates: Coordinates;
}

export function sugiyamaLayout(g: Graph, opts?: LayoutOptions): LayoutResult {
  const g0 = normalizeGraph(g);

  // Phase 1: cycle removal
  const cycleRes = removeCycles_DFS(g0);
  const gAcyclic = cycleRes.acyclic;

  // Phase 2: layering
  const layering = opts?.ignoreCrossLaneEdges
    ? assignLayers_LaneAwareCompact(gAcyclic, {
        compactSingleInput: opts?.compactSingleInput ?? LAYERING.DEFAULT_COMPACT_SINGLE_INPUT,
        ignoreCrossLaneEdges: true,
        direction: opts?.direction,
      })
    : assignLayers_Gravity(gAcyclic, {
        compactSingleInput: opts?.compactSingleInput ?? LAYERING.DEFAULT_COMPACT_SINGLE_INPUT,
        preferLongEdgesStraight: opts?.preferLongEdgesStraight,
        ignoreCrossLaneEdges: false,
        optimizeRanksByCrossings: opts?.optimizeRanksByCrossings,
      });
  const { layering: properLayering, graphWithDummies } = makeProperLayering(layering, gAcyclic);
  // Phase 3: ordering
  const ordered = orderLayers(properLayering, graphWithDummies);

  // Phase 4: coordinates
  const coords0 = assignCoordinates(ordered, graphWithDummies, {
    layerGap: opts?.layerGap,
    nodeGap: opts?.nodeGap,
    straightenLongEdges: opts?.straightenLongEdges ?? true,
    direction: opts?.direction,
  });
  const coordinates = mergeDummies(coords0, graphWithDummies, g);

  return {
    acyclic: gAcyclic,
    reversed: cycleRes.reversed,
    layering: properLayering,
    ordered,
    coordinates,
  };
}
