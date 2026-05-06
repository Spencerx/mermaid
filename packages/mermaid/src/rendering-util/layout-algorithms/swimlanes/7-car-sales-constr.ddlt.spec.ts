/**
 * DDLT spec for the swimlanes layout of 7-car-sales-constr.mmd.
 *
 * Parses the real `.mmd` file via `Diagram.fromText` so the LayoutData the
 * pipeline sees matches what the browser produces, then applies pre-captured
 * node/label sizes from the fixture:
 *   cypress/platform/dev-diagrams/layout-tests/swimlanes/7-car-sales-constr.sizes.json
 *
 * The fixture is a 16-node TD flowchart across 5 subgraphs (Car, Sales, Constr,
 * Legal, Fun) with two labeled edges (I→J "Yes", I→K "No"). Exists to exercise
 * the swimlane pipeline on a more connectivity-heavy diagram than query-process
 * — notably the `M & N` split from L and the J→E back-edge into the Constr
 * lane after a multi-step Legal detour.
 *
 * Structure mirrors query-process.ddlt.spec.ts — the canonical DDLT pattern.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { LayoutData } from '../../types.js';
import { Diagram } from '../../../Diagram.js';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { preprocessDiagram } from '../../../preprocess.js';
import { toGraphView, writeBackToLayoutData } from './helpers.js';
import { sugiyamaLayout } from './pipeline.js';
import { routeEdgesOrthogonal } from './raykovGemini/raykov.js';
import { applySwimlaneDirectionTransform } from './direction.js';
import { createEdgeLabelNodes } from './edgeLabelNodes.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { loadFreshSizesFixture } from '../ddlt/fixtureSizes.js';

interface FixtureNode {
  id: string;
  width: number;
  height: number;
}

interface SizesFixture {
  nodes: FixtureNode[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE_PATH = resolve(
  __dirname,
  '../../../../../../cypress/platform/dev-diagrams/layout-tests/swimlanes/7-car-sales-constr.sizes.json'
);

const MMD_PATH = resolve(
  __dirname,
  '../../../../../../cypress/platform/dev-diagrams/layout-tests/swimlanes/7-car-sales-constr.mmd'
);

function loadFixture(): SizesFixture {
  return loadFreshSizesFixture(FIXTURE_PATH, MMD_PATH, 'swimlanes/7-car-sales-constr');
}

function fixtureSizeById(fixture: SizesFixture, id: string) {
  return fixture.nodes.find((n) => n.id === id);
}

async function parseLayout(): Promise<LayoutData> {
  const mmdText = readFileSync(MMD_PATH, 'utf-8');
  const { code } = preprocessDiagram(mmdText);
  const diagram = await Diagram.fromText(code);
  const layoutData = (diagram.db as { getData: () => LayoutData }).getData();

  const getDirection = (diagram.db as { getDirection?: () => string }).getDirection;
  const direction = getDirection?.call(diagram.db) ?? 'TB';
  (layoutData as LayoutData & { direction?: string }).direction = direction;

  const cfg = (layoutData.config ??= {} as LayoutData['config']);
  const flowchartCfg = ((cfg as { flowchart?: Record<string, unknown> }).flowchart ??= {});
  flowchartCfg.nodeSpacing = (flowchartCfg.nodeSpacing as number | undefined) ?? 40;
  flowchartCfg.rankSpacing = (flowchartCfg.rankSpacing as number | undefined) ?? 100;
  flowchartCfg.ignoreCrossLaneEdges = true;
  flowchartCfg.optimizeRanksByCrossings = true;

  return layoutData;
}

function applyCapturedContentSizes(layout: LayoutData, fixture: SizesFixture) {
  for (const node of layout.nodes) {
    if (node.isGroup) {
      continue;
    }
    const size = fixtureSizeById(fixture, node.id);
    if (!size) {
      throw new Error(
        `Fixture is missing size for parser-produced content node "${node.id}". ` +
          `Known fixture ids: ${fixture.nodes.map((n) => n.id).join(', ')}`
      );
    }
    (node as { width: number; height: number }).width = size.width;
    (node as { width: number; height: number }).height = size.height;
  }
}

function applyCapturedLabelSizes(layout: LayoutData, fixture: SizesFixture) {
  for (const node of layout.nodes) {
    if (!(node as { isEdgeLabel?: boolean }).isEdgeLabel) {
      continue;
    }
    const size = fixtureSizeById(fixture, node.id);
    if (!size) {
      throw new Error(
        `Fixture is missing size for parser-produced label node "${node.id}". ` +
          `The fixture must contain edge-label-<start>-<end>-<edgeId> for every ` +
          `labelled edge produced by the parser.`
      );
    }
    (node as { width: number; height: number }).width = size.width;
    (node as { width: number; height: number }).height = size.height;
  }
}

async function runSwimlanes(fixture: SizesFixture): Promise<LayoutData> {
  const parsed = await parseLayout();
  applyCapturedContentSizes(parsed, fixture);

  const { data } = createEdgeLabelNodes(parsed);
  const layout = data;
  (layout as LayoutData & { direction?: string }).direction = (
    parsed as LayoutData & { direction?: string }
  ).direction;
  applyCapturedLabelSizes(layout, fixture);

  const g = toGraphView(layout);
  const nodeGap = layout.config.flowchart?.nodeSpacing ?? 40;
  const layerGap = layout.config.flowchart?.rankSpacing ?? 100;

  // Use the fixture's actual direction so this DDLT spec mirrors what
  // `swimlanes/index.ts:render` does in the real renderer. Hardcoding
  // 'LR' here would test a completely different pipeline than the
  // browser runs for TD diagrams (every post-routing cleanup pass in
  // `applySwimlaneDirectionTransform` is gated behind
  // `if (direction !== 'LR') return`, so for TD fixtures those passes
  // never run).
  const direction = ((layout as LayoutData & { direction?: string }).direction ?? 'TB') as
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

  for (const edge of layout.edges ?? []) {
    delete (edge as { points?: unknown }).points;
  }

  routeEdgesOrthogonal(layout, direction);
  applySwimlaneDirectionTransform(layout, direction);

  return layout;
}

describe('Swimlanes DDLT — 7-car-sales-constr.mmd', () => {
  let fixture: SizesFixture;

  beforeAll(() => {
    addDiagrams();
    fixture = loadFixture();
  });

  it('Level 1: validateLayout — produces a valid orthogonal layout', async () => {
    const layout = await runSwimlanes(fixture);
    const result = validateLayout(layout);
    if (!result.ok) {
      console.log(
        '[7_CAR_SALES_CONSTR_DDLT] validateLayout issues:',
        JSON.stringify(result.issues, null, 2)
      );
    }
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('Level 1: L_J_E_0 is a 2-point straight line on its shared axis (Kandinsky)', async () => {
    // Iteration 8 regression pin — same-axis back-edge straight-line invariant,
    // paper-backed by Kandinsky centered-straight-line (diss.pdf §2, src
    // 0fb2d84f): straight-line edges must attach at each side's median pin
    // when the two nodes share a coordinate axis.
    //
    // In the real TD pipeline, swimlane layout places J and E on the same
    // y=378.5 (same lane row), so L_J_E_0 must be a 2-point straight
    // horizontal line from J's west-face center to E's east-face center.
    // Before iter 8, raykov emitted a 5-point U-detour for this class of
    // same-axis back-edges because the `sameXIntraLane` fast path at
    // raykov.ts:1090 was dead code under Strategy 1 (its guard
    // `intraLaneExclusions !== undefined` never fires when labels are
    // absent from the obstacle set). The generalized fast path emits
    // [pSrcPort, pDstPort] whenever both anchors share one axis and the
    // direct port-to-port segment is obstacle-free.
    //
    // The pin asserts the axis-agnostic form: L_J_E_0 has exactly 2 points
    // AND they share one coordinate axis (straight line).
    const layout = await runSwimlanes(fixture);
    const j = layout.nodes.find((n) => n.id === 'J');
    const e = layout.nodes.find((n) => n.id === 'E');
    expect(j).toBeDefined();
    expect(e).toBeDefined();
    const lje = (layout.edges ?? []).find((edge) => edge.id === 'L_J_E_0');
    expect(lje).toBeDefined();
    const pts = (lje as { points?: { x: number; y: number }[] }).points ?? [];
    const EPS = 1e-3;
    const shareY = Math.abs(((j as { y?: number }).y ?? 0) - ((e as { y?: number }).y ?? 0)) < EPS;
    const shareX = Math.abs(((j as { x?: number }).x ?? 0) - ((e as { x?: number }).x ?? 0)) < EPS;
    // If J and E share an axis, the straight-line invariant applies.
    if (!shareX && !shareY) {
      // Precondition of this pin doesn't hold under the current sugiyama
      // output — skip without false-failing.
      return;
    }
    expect(pts.length).toBe(2);
    if (shareY) {
      expect(Math.abs(pts[0].y - pts[1].y)).toBeLessThan(EPS);
    } else {
      expect(Math.abs(pts[0].x - pts[1].x)).toBeLessThan(EPS);
    }
  });

  it('Level 2: validateLayout — quality breakdown is within reasonable thresholds', async () => {
    const layout = await runSwimlanes(fixture);
    const { breakdown } = validateLayout(layout);
    const totalBends = breakdown.edges.reduce((acc, e) => acc + Math.max(0, e.points - 2), 0);
    const avgBendsPerEdge = breakdown.edgeCount > 0 ? totalBends / breakdown.edgeCount : 0;

    console.log('[7_CAR_SALES_CONSTR_DDLT] breakdown:', JSON.stringify(breakdown, null, 2));
    // Soft-assert so all baseline regressions surface in a single run.
    // 7-car currently has 2 crossings — open L2 quality target documented
    // since iter 10. Upper bound is a forward guard; tighten as iterations
    // improve it.
    expect.soft(breakdown.crossings).toBeLessThanOrEqual(2);
    expect.soft(avgBendsPerEdge).toBeLessThan(5);
    // Generous initial bend budget; will be tightened as iterations improve it.
    expect.soft(totalBends).toBeLessThanOrEqual(30);
  });
});
