import type { LayoutData } from '../../types.js';
import { postProcessSwimlaneLayout, validateSwimlanesLayout } from './postProcessing.js';
import { toGraphView, writeBackToLayoutData } from './helpers.js';
import { sugiyamaLayout } from './pipeline.js';
import { routeEdgesOrthogonal as raykovRouting } from './raykovGemini/raykov.js';

export type SwimlaneDirection = 'TB' | 'LR' | 'BT' | 'RL';

function getSwimlaneDirection(data4Layout: LayoutData): SwimlaneDirection {
  return ((data4Layout as LayoutData & { direction?: string }).direction ??
    'TB') as SwimlaneDirection;
}

/**
 * Pure swimlane layout core shared by browser rendering and DDLT.
 *
 * The browser measures DOM nodes before this runs; DDLT injects captured sizes
 * before calling the same function.
 */
export function runSwimlaneLayoutCore(data4Layout: LayoutData): SwimlaneDirection {
  const g = toGraphView(data4Layout);
  const nodeGap = data4Layout.config.flowchart?.nodeSpacing ?? 40;
  const layerGap = data4Layout.config.flowchart?.rankSpacing ?? 100;
  const ignoreCrossLaneEdges = Boolean(
    (data4Layout.config as { flowchart?: { ignoreCrossLaneEdges?: unknown } }).flowchart
      ?.ignoreCrossLaneEdges
  );
  const optimizeRanksSetting = (
    data4Layout.config as { flowchart?: { optimizeRanksByCrossings?: boolean } }
  ).flowchart?.optimizeRanksByCrossings;
  const optimizeRanksByCrossings =
    optimizeRanksSetting !== undefined ? optimizeRanksSetting : ignoreCrossLaneEdges;
  const direction = getSwimlaneDirection(data4Layout);

  const { ordered, coordinates } = sugiyamaLayout(g, {
    nodeGap,
    layerGap,
    sweeps: 3,
    useTranspose: true,
    heuristic: 'median',
    straightenLongEdges: true,
    ignoreCrossLaneEdges,
    optimizeRanksByCrossings,
    direction,
  });
  writeBackToLayoutData(g, ordered, coordinates, { nodeGap, layerGap });

  for (const edge of data4Layout.edges ?? []) {
    delete edge.points;
  }
  raykovRouting(data4Layout, direction);

  for (const edge of data4Layout.edges ?? []) {
    if (!edge.curve || edge.curve === 'basis') {
      edge.curve = 'rounded';
    }
  }

  postProcessSwimlaneLayout(data4Layout, direction);

  validateSwimlanesLayout(data4Layout);

  return direction;
}
