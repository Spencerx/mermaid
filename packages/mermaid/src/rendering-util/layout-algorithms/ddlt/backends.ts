import type { LayoutData } from '../../types.js';
import { toGraphView, writeBackToLayoutData } from '../swimlanes/helpers.js';
import { sugiyamaLayout } from '../swimlanes/pipeline.js';
import { routeEdgesOrthogonal } from '../swimlanes/raykovGemini/raykov.js';
import { applySwimlaneDirectionTransform } from '../swimlanes/direction.js';
import { createEdgeLabelNodes } from '../swimlanes/edgeLabelNodes.js';
import type { LayoutTestBackend, LayoutTestBackendId, OrthogonalTrace } from './types.js';
import { applyFixtureContentSizesStrict, applyFixtureLabelSizesStrict } from './fixtureSizes.js';
import { parseMmdFileToLayoutData } from './parseToLayoutData.js';
import type { DdltFixtureProfile, SizesFixture } from './types.js';

/**
 * The `domus-orthogonal` backend is not available on this branch — the domus
 * subtree (`../domus/`) lands on its own branch. The swimlane-improve-loop
 * only exercises the `'swimlanes'` backend path. When domus merges, replace
 * this stub with the byte-equivalent pair (`runDomusBrowserLayout`,
 * `preloadLibavoidAdapterForLayout`, `injectDomusEdgeLabelNodes`).
 */
function domusBackendUnavailable(): never {
  throw new Error(
    "DDLT: domus-orthogonal backend not available on this branch — only 'swimlanes' is supported"
  );
}

function topUpSwimlaneFlowchartConfig(layout: LayoutData): void {
  const cfg = (layout.config ??= {} as LayoutData['config']);
  const flowchartCfg = ((cfg as { flowchart?: Record<string, unknown> }).flowchart ??= {});
  flowchartCfg.nodeSpacing = (flowchartCfg.nodeSpacing as number | undefined) ?? 40;
  flowchartCfg.rankSpacing = (flowchartCfg.rankSpacing as number | undefined) ?? 100;
  flowchartCfg.ignoreCrossLaneEdges = true;
  flowchartCfg.optimizeRanksByCrossings = true;
}

/**
 * DOMUS orthogonal routing + overlay finalize. **Not available on this branch.**
 * Throws on call so any accidental usage of the domus backend surfaces as a
 * loud error rather than a silent no-op.
 */
export async function runDomusOrthogonalDdlt(
  _layout: LayoutData,
  _options?: { trace?: OrthogonalTrace }
): Promise<void> {
  domusBackendUnavailable();
}

/**
 * Swimlanes pipeline (mirrors `swimlanes/query-process.ddlt.spec.ts`).
 * Mutates `layout` to hold the finished `LayoutData` from the swimlanes subgraph.
 */
export function runSwimlanesDdlt(layout: LayoutData, sizes: SizesFixture): void {
  topUpSwimlaneFlowchartConfig(layout);
  applyFixtureContentSizesStrict(layout, sizes);

  const { data } = createEdgeLabelNodes(layout);
  const out = data;
  (out as LayoutData & { direction?: string }).direction = (
    layout as LayoutData & { direction?: string }
  ).direction;
  applyFixtureLabelSizesStrict(out, sizes);

  const g = toGraphView(out);
  const nodeGap = out.config.flowchart?.nodeSpacing ?? 40;
  const layerGap = out.config.flowchart?.rankSpacing ?? 100;
  const direction = ((out as LayoutData & { direction?: string }).direction ?? 'TB') as
    | 'TB'
    | 'LR'
    | 'BT'
    | 'RL';

  const { ordered, coordinates } = sugiyamaLayout(g, {
    nodeGap,
    layerGap,
    sweeps: 3,
    useTranspose: true,
    heuristic: 'median',
    cycleHeuristic: 'dfs',
    straightenLongEdges: true,
    ignoreCrossLaneEdges: true,
    optimizeRanksByCrossings: true,
    direction,
  });

  writeBackToLayoutData(g, ordered, coordinates, { nodeGap, layerGap });

  for (const edge of out.edges ?? []) {
    delete (edge as { points?: unknown }).points;
  }

  routeEdgesOrthogonal(out, direction);
  applySwimlaneDirectionTransform(out, direction);

  layout.nodes = out.nodes;
  layout.edges = out.edges;
  layout.config = out.config;
}

/**
 * Parse `.mmd`, apply fixture sizes, then run the given backend (mutates returned `LayoutData`).
 * Only `'swimlanes'` is supported on this branch; `'domus-orthogonal'` throws.
 */
export async function parseApplySizesAndLayout(
  mmdPath: string,
  sizes: SizesFixture,
  backendId: LayoutTestBackendId,
  _options?: { trace?: OrthogonalTrace }
): Promise<LayoutData> {
  if (backendId !== 'swimlanes') {
    domusBackendUnavailable();
  }
  const layout = await parseMmdFileToLayoutData(mmdPath, { stampFlowchartRendererFields: true });
  (layout as { layoutAlgorithm?: string }).layoutAlgorithm = 'swimlanes';
  runSwimlanesDdlt(layout, sizes);
  return layout;
}

/** Returns a DOM-free layout runner. `swimlanes` must use `parseApplySizesAndLayout()` (needs fixture sizes mid-pipeline); `domus-orthogonal` throws. */
export function getLayoutTestBackend(_id: LayoutTestBackendId): LayoutTestBackend {
  domusBackendUnavailable();
}

export function backendsForProfile(profile: DdltFixtureProfile): LayoutTestBackendId[] {
  if (profile === 'swimlanes') {
    return ['swimlanes'];
  }
  return ['domus-orthogonal'];
}
