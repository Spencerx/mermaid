import type { Graph, Layering, OrderedLayers, Coordinates, Edge } from './helpers.js';
import { normalizeGraph } from './phase0.helpers.js';
import { removeCycles_DFS, removeCycles_BergerShor, removeCycles_Eades } from './phase1.cycles.js';
// cspell:ignore eades

import { assignLayers_CoffmanGraham } from './phase2.coffmanGraham.js';
import { assignLayers_Gravity } from './phase2.gravity.js';
import { assignLayers_LaneAwareCompact } from './phase2.laneAwareCompact.js';
import { makeProperLayering } from './phase2.dummies.js';
import { orderLayers } from './phase3.ordering.js';
import { assignCoordinates } from './phase4.coordinates.js';
import { mergeDummies } from './phase4.mergeDummies.js';
import { CYCLE_REMOVAL, LAYERING } from './config.js';

export interface LayoutOptions {
  // Cycle removal
  cycleHeuristic?: 'dfs' | 'berger-shor' | 'eades';
  // Layering
  widthBound?: number; // Coffman-Graham width bound if provided
  preferLongEdgesStraight?: boolean;
  compactSingleInput?: boolean; // default true for compact swimlanes
  ignoreCrossLaneEdges?: boolean;
  optimizeRanksByCrossings?: boolean;
  // Ordering
  sweeps?: number;
  useTranspose?: boolean;
  heuristic?: 'median' | 'barycenter';
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
  const cycleHeuristic = opts?.cycleHeuristic ?? CYCLE_REMOVAL.DEFAULT_HEURISTIC;

  // Phase 1: cycle removal
  let cycleRes;
  switch (cycleHeuristic) {
    case 'berger-shor':
      cycleRes = removeCycles_BergerShor(g0);
      break;
    case 'eades':
      cycleRes = removeCycles_Eades(g0);
      break;
    case 'dfs':
    default:
      cycleRes = removeCycles_DFS(g0);
      break;
  }
  const gAcyclic = cycleRes.acyclic;

  // Phase 2: layering
  const layering =
    opts?.widthBound != null
      ? assignLayers_CoffmanGraham(gAcyclic, opts.widthBound)
      : opts?.ignoreCrossLaneEdges
        ? assignLayers_LaneAwareCompact(gAcyclic, {
            compactSingleInput: opts?.compactSingleInput ?? LAYERING.DEFAULT_COMPACT_SINGLE_INPUT,
            ignoreCrossLaneEdges: true,
          })
        : assignLayers_Gravity(gAcyclic, {
            compactSingleInput: opts?.compactSingleInput ?? LAYERING.DEFAULT_COMPACT_SINGLE_INPUT,
            preferLongEdgesStraight: opts?.preferLongEdgesStraight,
            ignoreCrossLaneEdges: false,
            optimizeRanksByCrossings: opts?.optimizeRanksByCrossings,
          });
  const { layering: properLayering, graphWithDummies } = makeProperLayering(layering, gAcyclic);
  // Phase 3: ordering
  const ordered = orderLayers(properLayering, graphWithDummies, {
    sweeps: opts?.sweeps,
    useTranspose: opts?.useTranspose,
    heuristic: opts?.heuristic,
  });

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
