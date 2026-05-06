import type { SVG } from '../../../mermaid.js';
import type { D3Selection } from '../../../types.js';
import { createGraphWithElements } from '../../createGraph.js';
import insertMarkers from '../../rendering-elements/markers.js';
import { clear as clearGraphlib } from '../dagre/mermaid-graphlib.js';
import { clear as clearNodes } from '../../rendering-elements/nodes.js';
import { clear as clearClusters } from '../../rendering-elements/clusters.js';
import { clear as clearEdges } from '../../rendering-elements/edges.js';
import type { LayoutData } from '../../types.js';
import { adjustLayout } from '../ipsecCola/adjustLayout.js';
import { toGraphView, writeBackToLayoutData, prepareLayoutForSwimlanes } from './helpers.js';
import { sugiyamaLayout } from './pipeline.js';
// import { routeEdges as raykovRouting } from './raykovGPT/raykov.js';
import { routeEdgesOrthogonal as raykovRouting } from './raykovGemini/raykov.js';
import { createEdgeLabelNodes } from './edgeLabelNodes.js';
import { log } from '../../../logger.js';
import { applySwimlaneDirectionTransform, validateSwimlanesLayout } from './direction.js';

// Feature flag for edge labels as nodes - can be toggled for testing
const USE_EDGE_LABEL_NODES = true;

// Debug log prefix for swimlane layout issues
const SWIMLANE_DEBUG = '[SWIMLANE_DEBUG]';

export async function render(data4Layout: LayoutData, svg: SVG) {
  const element = svg.select('g') as unknown as D3Selection<SVGElement>;
  // Insert markers and clear previous elements
  insertMarkers(element, data4Layout.markers, data4Layout.type, data4Layout.diagramId);
  clearNodes();
  clearEdges();
  clearClusters();
  clearGraphlib();

  // Prepare layout data: render all group nodes using the swimlane cluster shape
  prepareLayoutForSwimlanes(data4Layout);

  // Debug: Log initial edges with labels before transformation
  log.debug(SWIMLANE_DEBUG, 'Initial edges with labels:');
  for (const edge of data4Layout.edges ?? []) {
    if (edge.label && edge.label.length > 0) {
      log.debug(
        SWIMLANE_DEBUG,
        `  Edge ${edge.id}: ${edge.start} -> ${edge.end}, label="${edge.label}"`
      );
    }
  }

  // Transform edges with labels into label nodes
  // This allows labels to participate in the Sugiyama layout
  if (USE_EDGE_LABEL_NODES) {
    const { data: transformedData, labelNodeMap } = createEdgeLabelNodes(data4Layout);
    // Update the layout data in place
    data4Layout.nodes = transformedData.nodes;
    data4Layout.edges = transformedData.edges;
    log.debug('[Swimlanes] Created edge label nodes:', labelNodeMap.size);

    // Debug: Log created label nodes
    log.debug(SWIMLANE_DEBUG, 'Created label nodes:');
    for (const [edgeId, labelNodeId] of labelNodeMap) {
      const labelNode = data4Layout.nodes.find((n: any) => n.id === labelNodeId);
      log.debug(
        SWIMLANE_DEBUG,
        `  ${edgeId} -> labelNode: ${labelNodeId}, parentId=${labelNode?.parentId}, w=${labelNode?.width}, h=${labelNode?.height}`
      );
    }
  }

  // Create the graph and insert the SVG groups and nodes
  const { groups } = await createGraphWithElements(element, data4Layout);

  // Perform the layout via Sugiyama swimlanes
  const g = toGraphView(data4Layout);
  const nodeGap = data4Layout.config.flowchart?.nodeSpacing ?? 40;
  const layerGap = data4Layout.config.flowchart?.rankSpacing ?? 100;
  const ignoreCrossLaneEdges = Boolean((data4Layout.config as any).flowchart?.ignoreCrossLaneEdges);
  const optimizeRanksSetting = (data4Layout.config as any).flowchart?.optimizeRanksByCrossings;
  const optimizeRanksByCrossings =
    optimizeRanksSetting !== undefined ? optimizeRanksSetting : ignoreCrossLaneEdges;
  const direction = ((data4Layout as any).direction ?? 'TB') as 'TB' | 'LR' | 'BT' | 'RL';
  const { ordered, coordinates } = sugiyamaLayout(g, {
    nodeGap,
    layerGap,
    sweeps: 3,
    useTranspose: true,
    heuristic: 'median',
    cycleHeuristic: 'dfs',
    straightenLongEdges: true,
    ignoreCrossLaneEdges,
    optimizeRanksByCrossings,
    direction,
  });
  writeBackToLayoutData(g, ordered, coordinates, { nodeGap, layerGap });

  // Debug: Log node positions after Sugiyama layout (before routing)
  log.debug(SWIMLANE_DEBUG, 'Node positions after Sugiyama layout:');
  for (const node of data4Layout.nodes ?? []) {
    if (!node.isGroup) {
      const isLabelNode = (node as any).isEdgeLabel;
      log.debug(
        SWIMLANE_DEBUG,
        `  ${node.id}: x=${node.x?.toFixed(2)}, y=${node.y?.toFixed(2)}, w=${node.width?.toFixed(2)}, h=${node.height?.toFixed(2)}${isLabelNode ? ' [LABEL_NODE]' : ''}, parentId=${node.parentId}`
      );
    }
  }

  // Edge routing: orthogonal router (lane-aware with crossing reduction)
  // cspell:ignore raykov
  log.debug('RAYKOV: Starting routing');
  // Clear edge points to force Raykov routing to take over
  for (const edge of data4Layout.edges ?? []) {
    delete edge.points;
  }
  raykovRouting(data4Layout, direction);

  // The swimlanes pipeline produces axis-aligned (Manhattan) routes. The
  // global flowchart curve default is `basis`, which would smooth over the
  // orthogonal L-bends and slant them. Force `rounded` for swimlane edges
  // unless the diagram author explicitly set a non-default curve.
  for (const edge of data4Layout.edges ?? []) {
    if (!edge.curve || edge.curve === 'basis') {
      edge.curve = 'rounded';
    }
  }

  // Debug logging: node positions BEFORE direction transform
  const contentNodes = (data4Layout.nodes ?? []).filter((n: any) => !n.isGroup);
  log.debug(`SWIMLANE_SPACING [${direction}] Before direction transform - node positions:`);
  for (const n of contentNodes) {
    log.debug(
      `SWIMLANE_SPACING [${direction}]   ${n.id}: x=${n.x?.toFixed(2)}, y=${n.y?.toFixed(2)}, w=${n.width?.toFixed(2)}, h=${n.height?.toFixed(2)}`
    );
  }

  // Calculate spacing between consecutive nodes (by Y for TB, by X for LR after transform)
  const sortedByY = [...contentNodes].sort((a: any, b: any) => (a.y ?? 0) - (b.y ?? 0));
  log.debug(
    `SWIMLANE_SPACING [${direction}] Before transform - vertical (Y) spacing between nodes:`
  );
  for (let i = 1; i < sortedByY.length; i++) {
    const prev = sortedByY[i - 1] as any;
    const curr = sortedByY[i] as any;
    const gap = (curr.y ?? 0) - (prev.y ?? 0);
    log.debug(`SWIMLANE_SPACING [${direction}]   ${prev.id} -> ${curr.id}: gap=${gap.toFixed(2)}`);
  }

  // Apply direction-specific transform (e.g. LR) after routing so that both
  // node coordinates and routed edge polylines are rotated together.
  applySwimlaneDirectionTransform(data4Layout, direction);

  // Debug logging: node positions AFTER direction transform
  log.debug(`SWIMLANE_SPACING [${direction}] After direction transform - node positions:`);
  for (const n of contentNodes) {
    const isLabelNode = (n as any).isEdgeLabel;
    log.debug(
      `SWIMLANE_SPACING [${direction}]   ${n.id}: x=${n.x?.toFixed(2)}, y=${n.y?.toFixed(2)}, w=${n.width?.toFixed(2)}, h=${n.height?.toFixed(2)}${isLabelNode ? ' [LABEL_NODE]' : ''}`
    );
  }

  // Debug: Check for overlapping nodes (especially label nodes with regular nodes)
  log.debug(SWIMLANE_DEBUG, 'Checking for overlapping nodes after direction transform:');
  for (let i = 0; i < contentNodes.length; i++) {
    const n1 = contentNodes[i] as any;
    const n1Left = (n1.x ?? 0) - (n1.width ?? 0) / 2;
    const n1Right = (n1.x ?? 0) + (n1.width ?? 0) / 2;
    const n1Top = (n1.y ?? 0) - (n1.height ?? 0) / 2;
    const n1Bottom = (n1.y ?? 0) + (n1.height ?? 0) / 2;

    for (let j = i + 1; j < contentNodes.length; j++) {
      const n2 = contentNodes[j] as any;
      const n2Left = (n2.x ?? 0) - (n2.width ?? 0) / 2;
      const n2Right = (n2.x ?? 0) + (n2.width ?? 0) / 2;
      const n2Top = (n2.y ?? 0) - (n2.height ?? 0) / 2;
      const n2Bottom = (n2.y ?? 0) + (n2.height ?? 0) / 2;

      // Check for overlap
      const overlapX = n1Left < n2Right && n1Right > n2Left;
      const overlapY = n1Top < n2Bottom && n1Bottom > n2Top;

      if (overlapX && overlapY) {
        log.debug(
          SWIMLANE_DEBUG,
          `  OVERLAP DETECTED: "${n1.id}" [${n1Left.toFixed(1)},${n1Top.toFixed(1)} to ${n1Right.toFixed(1)},${n1Bottom.toFixed(1)}] overlaps "${n2.id}" [${n2Left.toFixed(1)},${n2Top.toFixed(1)} to ${n2Right.toFixed(1)},${n2Bottom.toFixed(1)}]`
        );
      }
    }
  }

  // Calculate spacing after transform
  if (direction === 'LR') {
    const sortedByX = [...contentNodes].sort((a: any, b: any) => (a.x ?? 0) - (b.x ?? 0));
    log.debug(
      `SWIMLANE_SPACING [${direction}] After transform - horizontal (X) spacing between nodes:`
    );
    for (let i = 1; i < sortedByX.length; i++) {
      const prev = sortedByX[i - 1] as any;
      const curr = sortedByX[i] as any;
      const gap = (curr.x ?? 0) - (prev.x ?? 0);
      log.debug(
        `SWIMLANE_SPACING [${direction}]   ${prev.id} -> ${curr.id}: gap=${gap.toFixed(2)}`
      );
    }
  }

  // Step 5: Final validation — detect remaining edge-node overlaps and
  // edge-edge crossings. Logs warnings but does not attempt fixes.
  validateSwimlanesLayout(data4Layout);

  await adjustLayout(data4Layout, groups);
}
